/** Workflow-safe types for AgentCore (no Node, no zod, no Date, no Math.random). */

export const CHAT_UPDATE = "anyagent.chat";
export const CLOSE_SIGNAL = "anyagent.close";
export const STATUS_QUERY = "anyagent.status";
export const ROTATION_QUERY = "anyagent.rotation";

export interface ChatInput {
  key: string;
  chatId: string;
  messageId: string;
  authorId: string;
  text: string;
  replyTo?: string;
}

export type Disposition = "opened" | "queued" | "duplicate";

export interface Admission {
  disposition: Disposition;
  turnNumber: number;
}

export interface CoreStatus {
  state: "idle" | "running" | "closing";
  queued: number;
  turns: number;
  accepted: number;
  failed: number;
  currentKey?: string;
  historyLength: number;
  continueAsNewSuggested: boolean;
}

export interface RotationHint {
  continueAsNewSuggested: boolean;
  historyLength: number;
  idle: boolean;
  accepted: number;
}

export type TurnHandler = (input: ChatInput, ctx: { turnNumber: number }) => Promise<void>;

export interface AgentCore {
  /** Registers handlers, loops until closed and drained. */
  run(handler: TurnHandler): Promise<void>;
}
