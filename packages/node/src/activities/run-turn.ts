import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decidePermission, type PermissionKind } from "@anyagent/core";
import {
  AcpSession,
  descriptorFor,
  HarnessError,
  type HarnessSession,
  type PermissionDecision,
  type PermissionRequest,
  startSession,
} from "@anyagent/harness";
import type { TurnRequest, TurnResult } from "@anyagent/workflows";
import { Context, heartbeat } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type { NodeStore } from "../store.js";

export class HarnessUnavailable extends Error {
  override name = "HarnessUnavailable";
  constructor(message: string) {
    super(message);
  }
}

export interface RunTurnDeps {
  store: NodeStore;
  /** Override session open (tests). */
  openSession?: (
    req: TurnRequest,
    resumeId: string | undefined,
  ) => Promise<{ session: HarnessSession; resumed: string }>;
}

function mapKind(kind: string | undefined): PermissionKind | undefined {
  if (!kind) return undefined;
  const k = kind.toLowerCase();
  const allowed: PermissionKind[] = [
    "read",
    "search",
    "think",
    "fetch",
    "edit",
    "delete",
    "move",
    "execute",
    "other",
  ];
  return (allowed as string[]).includes(k) ? (k as PermissionKind) : "other";
}

function safeHeartbeat(payload: unknown): void {
  try {
    heartbeat(payload);
  } catch {
    // Outside an activity context (unit tests).
  }
}

function bindCancellation(session: HarnessSession): void {
  try {
    Context.current().cancellationSignal.addEventListener("abort", () => {
      session.cancel();
    });
  } catch {
    // Outside an activity context (unit tests).
  }
}

async function openFakeOrReal(
  req: TurnRequest,
  resumeId: string | undefined,
): Promise<{ session: HarnessSession; resumed: string }> {
  if (req.spec.harness === "fake") {
    const scriptDir = mkdtempSync(join(tmpdir(), "anybot-turn-"));
    const scriptPath = join(scriptDir, "script.json");
    const script = {
      turns: [
        {
          match: "WRITE_PLEASE",
          steps: [
            {
              tool: {
                id: "w1",
                title: "Write",
                kind: "edit",
                permission: true,
                effect: { writeFile: { path: "out.txt", content: "x" } },
              },
            },
            { say: "write step done" },
          ],
        },
        {
          match: "CRED_PLEASE",
          steps: [
            {
              tool: {
                id: "c1",
                title: "Bash",
                kind: "execute",
                rawInput: { command: "cat ~/.ssh/id_rsa" },
                permission: true,
              },
            },
            { say: "cred step done" },
          ],
        },
        {
          match: "SLEEP",
          steps: [{ sleep: 30_000 }, { say: "woke" }],
        },
        { steps: [{ say: `reply:${req.text}` }] },
      ],
    };
    writeFileSync(scriptPath, JSON.stringify(script));
    const cwd = req.spec.workdir ?? join(scriptDir, "work");
    mkdirSync(cwd, { recursive: true });
    const env = {
      ANYAGENT_FAKE_SCRIPT: scriptPath,
      ANYAGENT_FAKE_STATE_DIR: join(scriptDir, "state"),
    };
    const opened = await AcpSession.open(
      descriptorFor("fake"),
      {
        cwd,
        env,
        approvalMode: req.spec.approvalMode,
        ...(req.spec.model ? { model: req.spec.model } : {}),
        instructions: req.spec.instructions,
      },
      resumeId,
    );
    return { session: opened.session as unknown as HarnessSession, resumed: opened.resumed };
  }

  try {
    return await startSession(
      req.spec.harness,
      {
        cwd: req.spec.workdir ?? process.cwd(),
        approvalMode: req.spec.approvalMode,
        ...(req.spec.model ? { model: req.spec.model } : {}),
        instructions: req.spec.instructions,
      },
      resumeId ? { resumeSessionId: resumeId } : {},
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|not installed|moves to v1|no usable sign-in/i.test(msg)) {
      throw new HarnessUnavailable(msg);
    }
    throw err;
  }
}

export function createRunTurn(deps: RunTurnDeps) {
  return async function runTurn(req: TurnRequest): Promise<TurnResult> {
    const prior = deps.store.getSession(req.workflowId);
    const same =
      prior &&
      prior.harness === req.spec.harness &&
      prior.model === (req.spec.model ?? "") &&
      prior.mode === req.spec.approvalMode;
    const resumeId = same ? prior.sessionId : undefined;

    const open = deps.openSession ?? openFakeOrReal;
    let opened: { session: HarnessSession; resumed: string };
    try {
      opened = await open(req, resumeId);
    } catch (err) {
      if (err instanceof HarnessUnavailable) {
        throw ApplicationFailure.nonRetryable(err.message, "HarnessUnavailable");
      }
      throw err;
    }

    const { session } = opened;
    const hb = setInterval(() => {
      safeHeartbeat({ sessionId: session.handle.sessionId });
    }, 10_000);

    const onPermission = async (preq: PermissionRequest): Promise<PermissionDecision> => {
      const mapped = mapKind(preq.kind);
      const d = decidePermission(req.spec.approvalMode, {
        toolName: preq.toolName ?? preq.title ?? "tool",
        ...(mapped ? { kind: mapped } : {}),
        ...(preq.title ? { title: preq.title } : {}),
        ...(preq.rawInput !== undefined ? { rawInput: preq.rawInput } : {}),
        ...(req.spec.workdir ? { home: req.spec.workdir } : {}),
      });
      const reject = preq.options.find((o) => /reject/i.test(o.optionId) || /reject/i.test(o.kind));
      const allow = preq.options.find((o) => /allow/i.test(o.optionId) || /allow/i.test(o.kind));
      if (d.allow) {
        return { outcome: "selected", optionId: allow?.optionId ?? "allow" };
      }
      return {
        outcome: "selected",
        optionId: reject?.optionId ?? "reject",
        reason: d.reason,
      };
    };

    try {
      bindCancellation(session);

      const result = await session.prompt({ text: req.text }, () => {}, onPermission);
      deps.store.putSession({
        workflowId: req.workflowId,
        harness: req.spec.harness,
        model: req.spec.model ?? "",
        mode: req.spec.approvalMode,
        sessionId: session.handle.sessionId,
      });
      return {
        text: result.text,
        stopReason: result.stopReason,
        sessionId: session.handle.sessionId,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    } catch (err) {
      if (err instanceof HarnessError) {
        throw ApplicationFailure.nonRetryable(err.message, "HarnessError");
      }
      throw err;
    } finally {
      clearInterval(hb);
      try {
        await session.close();
      } catch {
        session.kill();
      }
    }
  };
}
