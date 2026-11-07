// Recovery spike only: deliberately not exported or connected to SessionHost.
// These records model durable workflow state; the tests serialize them across a simulated restart.
import { isDeepStrictEqual } from "node:util";

export interface CodexApproval {
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
  params: {
    threadId: string;
    turnId: string;
    itemId: string;
    approvalId?: string | null;
    startedAtMs?: number;
    [key: string]: unknown;
  };
}

export interface ApprovalCheckpoint {
  request: CodexApproval;
  state: "pending" | "decided" | "responded" | "completed";
  decision?: "accept" | "decline" | "cancel";
}

export type RecoveryAction =
  | { type: "wait"; requestId: string }
  | { type: "reply"; requestId: string; decision: "accept" | "decline" | "cancel" }
  | { type: "stop"; reason: string };

/** Transport JSON-RPC ids route replies; they do not identify logical operations. */
export function approvalKey(request: CodexApproval): string {
  const p = request.params;
  return JSON.stringify([request.method, p.threadId, p.turnId, p.itemId, p.approvalId ?? null]);
}

function semantics(request: CodexApproval): Record<string, unknown> {
  // A timestamp can change when a callback is replayed. Every other field is authorization context:
  // command, cwd, environment, network permissions, proposed policy amendments, grantRoot, etc.
  const { startedAtMs: _timestamp, ...rest } = request.params;
  return rest;
}

/** No command-text matching and no new approval when an interrupted operation cannot be correlated. */
export function recoverApproval(saved: ApprovalCheckpoint, live?: CodexApproval): RecoveryAction {
  if (saved.state === "completed")
    return { type: "stop", reason: "Operation already completed; do not replay it." };
  if (!live)
    return {
      type: "stop",
      reason: "Original approval callback was not restored; inspect the interrupted turn.",
    };
  if (approvalKey(saved.request) !== approvalKey(live)) {
    return {
      type: "stop",
      reason: "Operation identity changed; no approval or automatic retry is safe.",
    };
  }
  if (!isDeepStrictEqual(semantics(saved.request), semantics(live))) {
    return {
      type: "stop",
      reason: "Authorization context changed under the same operation identity.",
    };
  }
  if (saved.state === "responded") {
    return {
      type: "stop",
      reason: "Decision was sent but execution is unconfirmed; inspect effects before retrying.",
    };
  }
  const requestId = approvalKey(saved.request);
  if (saved.state === "pending") return { type: "wait", requestId };
  if (saved.decision) return { type: "reply", requestId, decision: saved.decision };
  return { type: "stop", reason: "Decision checkpoint is incomplete." };
}
