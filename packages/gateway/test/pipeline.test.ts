import type { ChatMessage } from "@anyagent/backend";
import type { AgentSpec } from "@anyagent/core";
import { describe, expect, it } from "vitest";
import { chatEvent, messageKey, pipelineEvent } from "../src/pipeline.js";

const owner = "owner-1";
const selfId = "agent-account";
const chatId = "chat-1";

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
  return {
    handle: "bot",
    harness: "claude-code",
    chatId,
    approvalMode: "read_only",
    allowedAuthors: [],
    lifecycle: "live",
    instructions: "hi",
    ...over,
  };
}

function msg(
  over: Partial<ChatMessage> & Pick<ChatMessage, "id" | "authorId" | "text">,
): ChatMessage {
  return {
    chatId,
    mentions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    edited: false,
    reactions: {},
    cursor: "1",
    ...over,
  };
}

const delivered = new Set<string>();

function run(
  event: ReturnType<typeof chatEvent>,
  opts: {
    agent?: AgentSpec;
    isDelivered?: (k: string) => boolean;
    ownerIds?: string[];
  } = {},
) {
  return pipelineEvent({
    event,
    agent: { agentId: "a1", spec: opts.agent ?? spec() },
    selfId,
    ownerIds: opts.ownerIds ?? [owner],
    isDelivered: opts.isDelivered ?? ((k) => delivered.has(k)),
  });
}

describe("T-WP5-01 pipeline table", () => {
  it("drops own-account message", () => {
    const r = run(chatEvent("added", msg({ id: "m1", authorId: selfId, text: "x" })));
    expect(r).toEqual({ action: "drop", reason: "own-account" });
  });

  it("drops agent-marked message", () => {
    const r = run(
      chatEvent(
        "added",
        msg({
          id: "m2",
          authorId: owner,
          text: "x",
          agent: { name: "bot", done: true },
        }),
      ),
    );
    expect(r).toEqual({ action: "drop", reason: "agent-marker" });
  });

  it("drops removed event", () => {
    const r = run(chatEvent("removed", msg({ id: "m3", authorId: owner, text: "x" }), "9"));
    expect(r).toEqual({ action: "drop", reason: "removed" });
  });

  it("drops duplicate / already-delivered key", () => {
    const key = messageKey(chatId, "m4");
    const r = run(chatEvent("added", msg({ id: "m4", authorId: owner, text: "x" })), {
      isDelivered: (k) => k === key,
    });
    expect(r).toEqual({ action: "drop", reason: "already-delivered" });
  });

  it("drops upsert of already-delivered key (edits)", () => {
    const key = messageKey(chatId, "m5");
    const r = run(chatEvent("upsert", msg({ id: "m5", authorId: owner, text: "edited" })), {
      isDelivered: (k) => k === key,
    });
    expect(r).toEqual({ action: "drop", reason: "already-delivered" });
  });

  it("drops author not allowed", () => {
    const r = run(chatEvent("added", msg({ id: "m6", authorId: "stranger", text: "x" })));
    expect(r).toEqual({ action: "drop", reason: "author-not-allowed" });
  });

  it("allows owner by default when allowedAuthors empty", () => {
    const r = run(chatEvent("added", msg({ id: "m7", authorId: owner, text: "hello" }), "c7"));
    expect(r.action).toBe("deliver");
    if (r.action === "deliver") {
      expect(r.input.key).toBe(messageKey(chatId, "m7"));
      expect(r.input.text).toBe("hello");
      expect(r.cursor).toBe("c7");
    }
  });

  it("allows explicit allowed author", () => {
    const r = run(chatEvent("added", msg({ id: "m8", authorId: "friend", text: "hi" })), {
      agent: spec({ allowedAuthors: ["friend"] }),
    });
    expect(r.action).toBe("deliver");
  });

  it("still delivers for paused agent (workflow decides)", () => {
    const r = run(chatEvent("added", msg({ id: "m9", authorId: owner, text: "x" })), {
      agent: spec({ lifecycle: "paused" }),
    });
    expect(r.action).toBe("deliver");
  });

  it("delivers a valid message", () => {
    const r = run(
      chatEvent("added", msg({ id: "m10", authorId: owner, text: "go", replyTo: "prev" }), "c10"),
    );
    expect(r).toMatchObject({
      action: "deliver",
      input: {
        key: messageKey(chatId, "m10"),
        chatId,
        messageId: "m10",
        authorId: owner,
        text: "go",
        replyTo: "prev",
      },
      cursor: "c10",
    });
  });
});
