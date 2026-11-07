/**
 * Gateway approval watcher: reactions / status edits → anybot.decision.
 */
import type { Backend, ChatMessage, ObjectRecord, WatchEvent } from "@anyagent/backend";
import {
  decideFromReactions,
  decideFromStatusEdit,
  decodeApprovalMessageRef,
  resolveApprovers,
} from "@anyagent/core";
import { type DecisionUpdateInput, decisionUpdate, workflowIdFor } from "@anyagent/workflows";
import type { Client, WorkflowClient } from "@temporalio/client";
import { WorkflowNotFoundError, WorkflowUpdateFailedError } from "@temporalio/client";
import { ApplicationFailure } from "@temporalio/common";
import { logGateway } from "./log.js";

export interface DecisionClient {
  deliverDecision(
    target: { spaceId: string; agentId: string },
    input: DecisionUpdateInput,
  ): Promise<void>;
}

export class TemporalDecisionClient implements DecisionClient {
  constructor(private readonly workflow: WorkflowClient) {}

  static fromClient(client: Client): TemporalDecisionClient {
    return new TemporalDecisionClient(client.workflow);
  }

  async deliverDecision(
    target: { spaceId: string; agentId: string },
    input: DecisionUpdateInput,
  ): Promise<void> {
    const workflowId = workflowIdFor(target.spaceId, target.agentId);
    try {
      const handle = this.workflow.getHandle(workflowId);
      const updateHandle = await handle.startUpdate(decisionUpdate, {
        args: [input],
        updateId: `decision:${input.requestId}`,
        waitForStage: "ACCEPTED",
      });
      await updateHandle.result();
    } catch (err) {
      if (isHarmlessDecisionError(err)) return;
      throw err;
    }
  }
}

function isHarmlessDecisionError(err: unknown): boolean {
  if (err instanceof WorkflowNotFoundError) return true;
  if (err instanceof WorkflowUpdateFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure) {
      if (cause.type === "UnknownApproval") return true;
    }
    const msg = cause instanceof Error ? cause.message : String(cause ?? err);
    if (/UnknownApproval|already decided|already_decided/i.test(msg)) return true;
  }
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /UnknownApproval|already decided|WorkflowNotFound/i.test(msg);
}

export interface PendingApprovalView {
  objectId: string;
  requestId: string;
  agentId: string;
  chatId: string;
  messageId: string;
  status: string;
}

export function pendingFromObject(obj: ObjectRecord): PendingApprovalView | undefined {
  const status = String(obj.fields.aa_status ?? "");
  if (status !== "pending") return undefined;
  const requestId = String(obj.fields.aa_request_id ?? "");
  const agentId = String(obj.fields.aa_requester ?? "");
  const ref = decodeApprovalMessageRef(String(obj.fields.aa_message ?? ""));
  if (!requestId || !agentId || !ref) return undefined;
  return {
    objectId: obj.id,
    requestId,
    agentId,
    chatId: ref.chatId,
    messageId: ref.messageId,
    status,
  };
}

export async function loadApproverContext(
  backend: Backend,
  opts: { owners: string[]; agentAccounts: string[] },
): Promise<{ approvers: string[]; agentAccounts: string[] }> {
  const settings = await backend.org.list("aa_settings");
  const raw = String(settings[0]?.fields.aa_approvers ?? "");
  const resolved = resolveApprovers({
    settingsApprovers: raw,
    owners: opts.owners,
    agentAccounts: opts.agentAccounts,
  });
  return { approvers: resolved.approvers, agentAccounts: opts.agentAccounts };
}

export async function evaluateApprovalMessage(opts: {
  backend: Backend;
  message: ChatMessage;
  pending: PendingApprovalView;
  approvers: string[];
  agentAccounts: string[];
  decision: DecisionClient;
  spaceId: string;
  orgId: string;
}): Promise<"sent" | "none"> {
  const full = (await opts.backend.chat.get(opts.message.chatId, opts.message.id)) ?? opts.message;
  const d = decideFromReactions({
    reactions: full.reactions,
    approvers: opts.approvers,
    agentAccounts: opts.agentAccounts,
  });
  if (d.kind === "none") {
    logGateway({
      org: opts.orgId,
      space: opts.spaceId,
      agent: opts.pending.agentId,
      outcome: "approval-reaction-ignored",
      detail: `request ${opts.pending.requestId}`,
    });
    return "none";
  }
  await opts.decision.deliverDecision(
    { spaceId: opts.spaceId, agentId: opts.pending.agentId },
    {
      requestId: opts.pending.requestId,
      approved: d.kind === "approved",
      decidedBy: d.decidedBy,
    },
  );
  logGateway({
    org: opts.orgId,
    space: opts.spaceId,
    agent: opts.pending.agentId,
    outcome: d.kind === "approved" ? "approval-approved" : "approval-denied",
    detail: `by ${d.decidedBy} request ${opts.pending.requestId}`,
  });
  return "sent";
}

export async function evaluateApprovalObject(opts: {
  backend: Backend;
  object: ObjectRecord;
  approvers: string[];
  agentAccounts: string[];
  decision: DecisionClient;
  spaceId: string;
  orgId: string;
}): Promise<"sent" | "none"> {
  const status = String(opts.object.fields.aa_status ?? "");
  if (status === "pending") {
    const pending = pendingFromObject(opts.object);
    if (!pending) return "none";
    const msg = await opts.backend.chat.get(pending.chatId, pending.messageId);
    if (!msg) return "none";
    return evaluateApprovalMessage({
      backend: opts.backend,
      message: msg,
      pending,
      approvers: opts.approvers,
      agentAccounts: opts.agentAccounts,
      decision: opts.decision,
      spaceId: opts.spaceId,
      orgId: opts.orgId,
    });
  }

  const d = decideFromStatusEdit({
    status,
    modifiedById: opts.object.modifiedById || undefined,
    approvers: opts.approvers,
    agentAccounts: opts.agentAccounts,
  });
  if (d.kind === "none") return "none";
  const requestId = String(opts.object.fields.aa_request_id ?? "");
  const agentId = String(opts.object.fields.aa_requester ?? "");
  if (!requestId || !agentId) return "none";
  await opts.decision.deliverDecision(
    { spaceId: opts.spaceId, agentId },
    {
      requestId,
      approved: d.kind === "approved",
      decidedBy: d.decidedBy,
    },
  );
  return "sent";
}

export interface ApprovalWatcherOpts {
  orgId: string;
  spaceId: string;
  backend: Backend;
  decision: DecisionClient;
  ownerIds: string[];
  agentAccounts: string[];
  sleep?: (ms: number) => Promise<void>;
}

export interface ApprovalWatcher {
  /** Map messageKey → pending view. */
  pendingByMessage: Map<string, PendingApprovalView>;
  stop: () => Promise<void>;
  /** Process one chat message update (tests). */
  handleChatMessage: (message: ChatMessage) => Promise<void>;
  /** Process one object event (tests). */
  handleObjectEvent: (event: WatchEvent) => Promise<void>;
  /** Re-scan all pending approvals (restart safety). */
  catchUp: () => Promise<void>;
}

function messageKey(chatId: string, messageId: string): string {
  return `${chatId}/${messageId}`;
}

/**
 * Watches pending aa_approval objects and evaluates reactions on their messages.
 */
export function startApprovalWatcher(opts: ApprovalWatcherOpts): ApprovalWatcher {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let stopped = false;
  const pendingByMessage = new Map<string, PendingApprovalView>();
  /** Local dedupe before Temporal updateId; avoids repeat deliverDecision spam. */
  const decided = new Set<string>();
  const abort = new AbortController();

  async function refreshContext() {
    return loadApproverContext(opts.backend, {
      owners: opts.ownerIds,
      agentAccounts: opts.agentAccounts,
    });
  }

  async function indexPending(obj: ObjectRecord): Promise<void> {
    const pending = pendingFromObject(obj);
    if (!pending) {
      // Drop any prior index for this object.
      for (const [k, v] of pendingByMessage) {
        if (v.objectId === obj.id) pendingByMessage.delete(k);
      }
      return;
    }
    pendingByMessage.set(messageKey(pending.chatId, pending.messageId), pending);
  }

  async function sendOnce(
    requestId: string,
    run: () => Promise<"sent" | "none">,
  ): Promise<"sent" | "none"> {
    if (decided.has(requestId)) return "none";
    const result = await run();
    if (result === "sent") decided.add(requestId);
    return result;
  }

  async function catchUp(): Promise<void> {
    const rows = await opts.backend.org.list("aa_approval", { aa_status: "pending" });
    const ctx = await refreshContext();
    for (const row of rows) {
      const full = (await opts.backend.org.get(row.id)) ?? row;
      await indexPending(full);
      const requestId = String(full.fields.aa_request_id ?? "");
      if (!requestId) continue;
      await sendOnce(requestId, () =>
        evaluateApprovalObject({
          backend: opts.backend,
          object: full,
          approvers: ctx.approvers,
          agentAccounts: ctx.agentAccounts,
          decision: opts.decision,
          spaceId: opts.spaceId,
          orgId: opts.orgId,
        }),
      );
    }
  }

  async function handleChatMessage(message: ChatMessage): Promise<void> {
    const key = messageKey(message.chatId, message.id);
    let pending = pendingByMessage.get(key);
    if (!pending) {
      // Lazy resolve: maybe watcher missed the object event.
      const rows = await opts.backend.org.list("aa_approval", { aa_status: "pending" });
      for (const row of rows) {
        const full = (await opts.backend.org.get(row.id)) ?? row;
        await indexPending(full);
      }
      pending = pendingByMessage.get(key);
    }
    if (!pending) return;
    const ctx = await refreshContext();
    await sendOnce(pending.requestId, () =>
      evaluateApprovalMessage({
        backend: opts.backend,
        message,
        pending: pending!,
        approvers: ctx.approvers,
        agentAccounts: ctx.agentAccounts,
        decision: opts.decision,
        spaceId: opts.spaceId,
        orgId: opts.orgId,
      }),
    );
  }

  async function handleObjectEvent(event: WatchEvent): Promise<void> {
    if (event.kind !== "object" || !event.object) return;
    if (event.object.type !== "aa_approval") return;
    await indexPending(event.object);
    const requestId = String(event.object.fields.aa_request_id ?? "");
    if (!requestId) return;
    const ctx = await refreshContext();
    await sendOnce(requestId, () =>
      evaluateApprovalObject({
        backend: opts.backend,
        object: event.object!,
        approvers: ctx.approvers,
        agentAccounts: ctx.agentAccounts,
        decision: opts.decision,
        spaceId: opts.spaceId,
        orgId: opts.orgId,
      }),
    );
  }

  void (async () => {
    try {
      await catchUp();
    } catch (err) {
      logGateway({
        org: opts.orgId,
        space: opts.spaceId,
        outcome: "approval-catchup-error",
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
    while (!stopped) {
      try {
        for await (const event of opts.backend.events.watch(
          { kind: "objects", type: "aa_approval" },
          { signal: abort.signal },
        )) {
          if (stopped) return;
          if (event.kind === "ready") continue;
          try {
            await handleObjectEvent(event);
          } catch (err) {
            logGateway({
              org: opts.orgId,
              space: opts.spaceId,
              outcome: "approval-object-error",
              detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
            });
          }
        }
      } catch {
        if (stopped) return;
        await sleep(500);
      }
      if (stopped) return;
      await sleep(500);
    }
  })();

  return {
    pendingByMessage,
    stop: async () => {
      stopped = true;
      abort.abort();
    },
    handleChatMessage,
    handleObjectEvent,
    catchUp,
  };
}
