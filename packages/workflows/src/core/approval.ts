/**
 * Temporal approval gate: anybot.permission / anybot.decision updates.
 * Deterministic — no Date, Math.random, I/O, or Node imports.
 */
import {
  ApplicationFailure,
  condition,
  defineUpdate,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import { ApprovalBook, type ApprovalRisk } from "./approval-book.js";
import type { CoreStatus, RotationHint } from "./types.js";
import { DECISION_UPDATE, PERMISSION_UPDATE } from "./types.js";

export interface PermissionUpdateInput {
  requestId: string;
  toolName: string;
  kind?: string;
  title?: string;
  rawInput?: unknown;
  summary?: string;
  risk?: ApprovalRisk;
  /** When false, gate returns deny immediately (floor / pre-decision). */
  needsApproval: boolean;
  denyReason?: string;
  expiresInMs: number;
}

export interface PermissionUpdateResult {
  approved: boolean;
  reason?: string;
}

export interface DecisionUpdateInput {
  requestId: string;
  approved: boolean;
  decidedBy: string;
  reason?: string;
}

export const permissionUpdate = defineUpdate<PermissionUpdateResult, [PermissionUpdateInput]>(
  PERMISSION_UPDATE,
);
export const decisionUpdate = defineUpdate<void, [DecisionUpdateInput]>(DECISION_UPDATE);

export interface ApprovalActivities {
  createApproval(i: {
    requestId: string;
    toolName: string;
    summary: string;
    risk: ApprovalRisk;
  }): Promise<void>;
  recordDecision(i: {
    requestId: string;
    approved: boolean;
    decidedBy: string;
    reason?: string;
    expired?: boolean;
  }): Promise<void>;
}

export interface ApprovalGate {
  book: ApprovalBook;
  attachToStatus(base: CoreStatus): CoreStatus;
  attachToRotation(base: RotationHint): RotationHint;
}

/**
 * Registers permission/decision handlers. Call from inside AgentCore.run (workflow context).
 */
export function installApprovalGate(opts?: {
  activities?: ApprovalActivities;
  /** Default TTL when input omits expiresInMs. */
  defaultExpiresInMs?: number;
}): ApprovalGate {
  const book = new ApprovalBook();
  const waiters = new Map<string, { resolve: (r: PermissionUpdateResult) => void }>();
  const inflight = new Map<string, Promise<PermissionUpdateResult>>();
  const created = new Set<string>();
  const acts: ApprovalActivities =
    opts?.activities ??
    proxyActivities<ApprovalActivities>({
      startToCloseTimeout: "1 minute",
      retry: { maximumAttempts: 3 },
    });
  const defaultTtl = opts?.defaultExpiresInMs ?? 30 * 60 * 1000;

  setHandler(
    permissionUpdate,
    async (input: PermissionUpdateInput): Promise<PermissionUpdateResult> => {
      if (!input.needsApproval) {
        return { approved: false, reason: input.denyReason ?? "denied" };
      }

      const existing = inflight.get(input.requestId);
      if (existing) return existing;

      const run = (async (): Promise<PermissionUpdateResult> => {
        const ttl = input.expiresInMs > 0 ? input.expiresInMs : defaultTtl;
        const entry = book.request({
          requestId: input.requestId,
          toolName: input.toolName,
          summary: input.summary ?? input.title ?? input.toolName,
          risk: input.risk ?? "unknown",
          expiresInMs: ttl,
        });

        if (entry.status === "approved") {
          return { approved: true, ...(entry.reason ? { reason: entry.reason } : {}) };
        }
        if (entry.status === "denied" || entry.status === "expired") {
          return { approved: false, reason: entry.reason ?? entry.status };
        }

        if (!created.has(input.requestId)) {
          created.add(input.requestId);
          await acts.createApproval({
            requestId: entry.requestId,
            toolName: entry.toolName,
            summary: entry.summary,
            risk: entry.risk,
          });
        }

        let done = false;
        let result: PermissionUpdateResult = { approved: false, reason: "denied" };
        waiters.set(input.requestId, {
          resolve: (r) => {
            result = r;
            done = true;
          },
        });

        // Race: decision vs TTL. Workflow-safe sleep + condition.
        const timer = sleep(ttl).then(async () => {
          if (book.get(input.requestId)?.status !== "pending") return;
          // Persist expiry before flipping book status so the activity is observed.
          await acts.recordDecision({
            requestId: input.requestId,
            approved: false,
            decidedBy: "system",
            reason: "expired",
            expired: true,
          });
          book.expire(input.requestId);
          const w = waiters.get(input.requestId);
          w?.resolve({ approved: false, reason: "expired" });
        });

        await Promise.race([
          condition(() => done || book.get(input.requestId)?.status !== "pending"),
          timer,
        ]);
        waiters.delete(input.requestId);

        const final = book.get(input.requestId);
        if (done) return result;
        if (final?.status === "approved") {
          return { approved: true, ...(final.reason ? { reason: final.reason } : {}) };
        }
        return { approved: false, reason: final?.reason ?? "denied" };
      })();

      inflight.set(input.requestId, run);
      try {
        return await run;
      } finally {
        inflight.delete(input.requestId);
      }
    },
  );

  setHandler(
    decisionUpdate,
    async (input: DecisionUpdateInput): Promise<void> => {
      const result = book.decide(input.requestId, {
        approved: input.approved,
        decidedBy: input.decidedBy,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
      if (result.outcome === "unknown") {
        throw ApplicationFailure.nonRetryable("UnknownApproval", "UnknownApproval");
      }
      if (result.outcome === "decided") {
        await acts.recordDecision({
          requestId: input.requestId,
          approved: input.approved,
          decidedBy: input.decidedBy,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        });
        waiters.get(input.requestId)?.resolve({
          approved: input.approved,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        });
      }
    },
    {
      validator: (input) => {
        if (!input || typeof input.requestId !== "string" || !input.requestId) {
          throw ApplicationFailure.nonRetryable("BadInput", "BadInput");
        }
        if (!book.get(input.requestId)) {
          throw ApplicationFailure.nonRetryable("UnknownApproval", "UnknownApproval");
        }
      },
    },
  );

  return {
    book,
    attachToStatus(base) {
      return {
        ...base,
        pendingApprovals: book.pending().map((e) => ({
          requestId: e.requestId,
          summary: e.summary,
          risk: e.risk,
        })),
      };
    },
    attachToRotation(base) {
      return { ...base, idle: base.idle && !book.hasPending() };
    },
  };
}
