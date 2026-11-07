/**
 * Shared contracts for the AnyBot workflow and node activities.
 * Types and constants only — no Node imports (workflow-safe).
 */

export const AGENT_WORKFLOW_TYPE = "AnyBot";
export const WORKFLOW_TASK_QUEUE = "anybot";

export const workflowIdFor = (spaceId: string, agentId: string): string =>
  `agent:${spaceId}:${agentId}`;

export const nodeQueueFor = (spaceId: string, handle: string): string =>
  `node:${spaceId}:${handle}`;

export interface AgentInit {
  orgId: string;
  spaceId: string;
  agentId: string;
  nodeQueue: string;
}

/** Plain-data AgentSpec for activity/workflow boundaries (no class instances). */
export interface AgentSpecWire {
  handle: string;
  harness: string;
  model?: string;
  chatId: string;
  approvalMode: "read_only" | "full" | "ask";
  allowedAuthors: string[];
  lifecycle: "live" | "paused";
  instructions: string;
  workdir?: string;
}

export type ResolvedConfig =
  | { ok: true; spec: AgentSpecWire; ownerIds: string[] }
  | {
      ok: false;
      reason: "invalid" | "unacceptable-editor" | "workdir-outside-roots" | "mode-unsupported";
      detail: string;
    };

export interface TurnRequest {
  orgId: string;
  spaceId: string;
  agentId: string;
  workflowId: string;
  chatId: string;
  messageId: string;
  authorId: string;
  text: string;
  spec: AgentSpecWire;
  replyTo?: string;
}

export interface TurnResult {
  text: string;
  stopReason: string;
  sessionId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    cachedWriteTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
}

export interface DeliverRequest {
  orgId: string;
  spaceId: string;
  chatId: string;
  kind: "reply" | "notice";
  text: string;
  key: string;
  replyTo?: string;
  /** When set, swap 👀 → ✅ on this message after posting. */
  clearEyesMessageId?: string;
}

export interface NodeActivities {
  resolveConfig(i: { orgId: string; spaceId: string; agentId: string }): Promise<ResolvedConfig>;
  markReceived(i: {
    orgId: string;
    spaceId: string;
    chatId: string;
    messageId: string;
  }): Promise<void>;
  runTurn(i: TurnRequest): Promise<TurnResult>;
  deliver(i: DeliverRequest): Promise<{ messageId: string }>;
  createApproval(i: {
    orgId: string;
    spaceId: string;
    agentId: string;
    requestId: string;
    toolName: string;
    summary: string;
    risk: string;
    expiresInMs: number;
    kind?: string;
    title?: string;
    rawInput?: unknown;
  }): Promise<{ approvalObjectId: string; messageId: string }>;
  recordDecision(i: {
    orgId: string;
    spaceId: string;
    agentId: string;
    requestId: string;
    approved: boolean;
    decidedBy: string;
    reason?: string;
    expired?: boolean;
  }): Promise<void>;
}

/** Failure → notice text (one notice per failure; loop continues). */
export type TurnFailureKind =
  | "interrupted"
  | "harness-unavailable"
  | "harness-error"
  | "empty-reply"
  | "invalid-config";

export function noticeForFailure(
  kind: TurnFailureKind,
  detail?: { harness?: string; message?: string; configDetail?: string },
): string {
  switch (kind) {
    case "interrupted":
      return "That turn was interrupted before it finished. Send the message again.";
    case "harness-unavailable":
      return `${detail?.harness ?? "The harness"} is not installed or not signed in on this machine. Run anybot doctor.`;
    case "harness-error": {
      const line = (detail?.message ?? "unknown error").split("\n")[0]?.slice(0, 200) ?? "";
      return `The harness reported an error: ${line}.`;
    }
    case "empty-reply":
      return "The agent finished without writing a reply.";
    case "invalid-config":
      return `I cannot run right now: ${detail?.configDetail ?? "invalid configuration"}. See anybot doctor.`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
