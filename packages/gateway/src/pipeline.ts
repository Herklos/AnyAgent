import type { ChatMessage, WatchEvent } from "@anyagent/backend";
import { type AgentSpec, isAllowedAuthor } from "@anyagent/core";
import type { ChatInput } from "@anyagent/workflows";

export interface PipelineAgent {
  agentId: string;
  spec: AgentSpec;
}

export interface PipelineInput {
  event: WatchEvent;
  agent: PipelineAgent;
  selfId: string;
  ownerIds: string[];
  isDelivered: (key: string) => boolean;
}

export type PipelineOutcome =
  | { action: "deliver"; input: ChatInput; cursor?: string }
  | { action: "drop"; reason: string };

/**
 * Pure filter: decide whether a chat watch event should start a turn.
 * Paused agents are still delivered (the workflow decides).
 */
export function pipelineEvent(input: PipelineInput): PipelineOutcome {
  const { event, agent, selfId, ownerIds, isDelivered } = input;
  if (event.kind !== "chat") return { action: "drop", reason: "not-chat" };
  if (event.op === "removed") return { action: "drop", reason: "removed" };

  const message = event.message;
  if (!message) return { action: "drop", reason: "no-message" };

  const key = messageKey(message.chatId, message.id);
  if (isDelivered(key)) return { action: "drop", reason: "already-delivered" };

  if (message.authorId === selfId) return { action: "drop", reason: "own-account" };
  if (message.agent) return { action: "drop", reason: "agent-marker" };

  if (
    !isAllowedAuthor({
      spec: agent.spec,
      authorId: message.authorId,
      ownerIds,
      agentAccountId: selfId,
    })
  ) {
    return { action: "drop", reason: "author-not-allowed" };
  }

  const chatInput: ChatInput = {
    key,
    chatId: message.chatId,
    messageId: message.id,
    authorId: message.authorId,
    text: message.text,
  };
  if (message.replyTo) chatInput.replyTo = message.replyTo;

  return {
    action: "deliver",
    input: chatInput,
    ...(event.cursor !== undefined ? { cursor: event.cursor } : {}),
  };
}

export function messageKey(chatId: string, messageId: string): string {
  return `chat:${chatId}:${messageId}`;
}

export function sourceForChat(chatId: string): string {
  return `chat:${chatId}`;
}

/** Helper for tests that build a synthetic chat event. */
export function chatEvent(
  op: "added" | "updated" | "upsert" | "removed",
  message: ChatMessage | undefined,
  cursor?: string,
): WatchEvent {
  if (op === "removed") {
    return {
      kind: "chat",
      op,
      id: message?.id ?? "unknown",
      ...(cursor !== undefined ? { cursor } : {}),
    };
  }
  if (!message) {
    throw new Error("chatEvent requires a message for non-removed ops");
  }
  const ev: WatchEvent = {
    kind: "chat",
    op,
    id: message.id,
    message,
  };
  if (cursor !== undefined) ev.cursor = cursor;
  return ev;
}
