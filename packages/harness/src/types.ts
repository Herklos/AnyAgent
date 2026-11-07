/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/types.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// The adapter interface (ADR 0003). Adapters are plain Node code, not workflow code: they run inside
// an activity on a node, and push events to a sink the activity wires to the agent's stream.

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export type AdapterEvent =
  | { type: "text_delta"; text: string; messageId?: string }
  | { type: "thought_delta"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      title?: string;
      kind?: string;
      status?: ToolStatus;
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | { type: "plan"; entries: { content: string; status: string; priority?: string }[] }
  | { type: "usage"; used: number; size: number; costUsd?: number }
  | { type: "info"; title?: string }
  | { type: "stderr"; text: string };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export interface PermissionRequest {
  /** Logical approval identity: ACP session/tool IDs, or a hash of Codex native callback scope. */
  requestId: string;
  sessionId: string;
  toolCallId: string;
  title?: string;
  kind?: string;
  toolName?: string;
  rawInput?: unknown;
  content?: unknown;
  options: PermissionOption[];
}

/** `reason` is the why of a refusal (a floor rule, the owner's note); the openai harness shows it to the model. */
export type PermissionDecision =
  | { outcome: "selected"; optionId: string; reason?: string }
  | { outcome: "cancelled" };

export interface McpServerStdio {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

export interface SessionInit {
  cwd: string;
  /** Written to the session by the caller as AGENTS.md etc.; adapters may also pass it as a system prompt. */
  instructions?: string;
  model?: string;
  effort?: string;
  mcpServers?: McpServerStdio[];
  /** Extra environment for the harness process (account directory, credentials). */
  env?: Record<string, string>;
  /** Folders besides `cwd` that the node lets the openai harness read without asking (the projects folder). */
  readRoots?: string[];
  /** The agent's Michel approval mode. The Codex adapter picks its sandbox from it (docs/specs/approvals-broad.md). */
  approvalMode?: "read_only" | "ask" | "auto" | "full";
  /** Folders besides `cwd` that a `workspace-write` sandbox may write: the repositories behind task worktrees keep their git data there. */
  writableRoots?: string[];
}

export interface SessionHandle {
  sessionId: string;
  harness: string;
  cwd: string;
  /** What the harness reported at initialize. */
  capabilities: AdapterCapabilities;
}

export interface AdapterCapabilities {
  loadSession: boolean;
  resumeSession: boolean;
  images: boolean;
  mcpHttp: boolean;
  mcpSse: boolean;
  agentName?: string;
  agentVersion?: string;
}

export interface TurnInput {
  text: string;
}

export interface TurnResult {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | string;
  /** The assistant's text for the turn, concatenated. */
  text: string;
  usage?: UsageInfo;
}

export type EventSink = (event: AdapterEvent) => void;

export type PermissionHandler = (req: PermissionRequest) => Promise<PermissionDecision>;

/** Shared process/session surface used by SessionHost. */
export interface HarnessSession {
  readonly handle: SessionHandle;
  readonly exited: Error | undefined;
  readonly closed: Promise<Error>;
  readonly pid: number | undefined;
  prompt(input: TurnInput, sink: EventSink, onPermission: PermissionHandler): Promise<TurnResult>;
  cancel(): void;
  close(): Promise<void>;
  kill(): void;
}
