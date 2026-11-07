/**
 * AnyBot workflow: AgentCore + node activities for one turn per chat update.
 * Deterministic — no Date, Math.random, I/O, or Node imports.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";
import {
  type AgentInit,
  type NodeActivities,
  noticeForFailure,
  type ResolvedConfig,
} from "./contracts.js";
import { createOwnCore } from "./core/own-core.js";
import type { ChatInput } from "./core/types.js";

function nodeActs(nodeQueue: string) {
  const common = {
    taskQueue: nodeQueue,
    heartbeatTimeout: "60 seconds" as const,
  };
  const acts = proxyActivities<NodeActivities>({
    ...common,
    startToCloseTimeout: "5 minutes",
    retry: { maximumAttempts: 3 },
  });
  const runTurnActs = proxyActivities<Pick<NodeActivities, "runTurn">>({
    ...common,
    startToCloseTimeout: "60 minutes",
    retry: { maximumAttempts: 1 },
  });
  return { acts, runTurnActs };
}

export async function AnyBot(init: AgentInit): Promise<void> {
  const { acts, runTurnActs } = nodeActs(init.nodeQueue);
  const core = createOwnCore();
  await core.run(async (input: ChatInput) => {
    await handleTurn(init, input, acts, runTurnActs);
  });
}

async function handleTurn(
  init: AgentInit,
  input: ChatInput,
  acts: NodeActivities,
  runTurnActs: Pick<NodeActivities, "runTurn">,
): Promise<void> {
  const cfg = await acts.resolveConfig({
    orgId: init.orgId,
    spaceId: init.spaceId,
    agentId: init.agentId,
  });

  if (!cfg.ok) {
    await acts.deliver({
      orgId: init.orgId,
      spaceId: init.spaceId,
      chatId: input.chatId,
      kind: "notice",
      text: noticeForFailure("invalid-config", { configDetail: cfg.detail }),
      key: `${input.key}:notice-invalid`,
    });
    return;
  }

  if (cfg.spec.lifecycle === "paused") return;

  // Defence in depth (gateway already filtered).
  if (!authorAllowed(cfg, input.authorId)) return;

  await acts.markReceived({
    orgId: init.orgId,
    spaceId: init.spaceId,
    chatId: input.chatId,
    messageId: input.messageId,
  });

  let turnText: string;
  try {
    const result = await runTurnActs.runTurn({
      orgId: init.orgId,
      spaceId: init.spaceId,
      agentId: init.agentId,
      workflowId: workflowInfo().workflowId,
      chatId: input.chatId,
      messageId: input.messageId,
      authorId: input.authorId,
      text: input.text,
      spec: cfg.spec,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    turnText = result.text;
  } catch (err) {
    await deliverFailureNotice(acts, init, input, err, cfg);
    return;
  }

  if (!turnText.trim()) {
    await acts.deliver({
      orgId: init.orgId,
      spaceId: init.spaceId,
      chatId: input.chatId,
      kind: "notice",
      text: noticeForFailure("empty-reply"),
      key: `${input.key}:notice-empty`,
      clearEyesMessageId: input.messageId,
    });
    return;
  }

  try {
    await acts.deliver({
      orgId: init.orgId,
      spaceId: init.spaceId,
      chatId: input.chatId,
      kind: "reply",
      text: turnText,
      key: input.key,
      replyTo: input.messageId,
      clearEyesMessageId: input.messageId,
    });
  } catch {
    // Post failed after retries: log only (chat is the channel). Activities log.
  }
}

function authorAllowed(cfg: Extract<ResolvedConfig, { ok: true }>, authorId: string): boolean {
  if (cfg.spec.allowedAuthors.length === 0) {
    return cfg.ownerIds.includes(authorId);
  }
  return cfg.spec.allowedAuthors.includes(authorId);
}

function failureType(err: unknown): { type: string; message: string; name: string } {
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure) {
    return {
      type: err.cause.type ?? "",
      message: err.cause.message,
      name: err.cause.name,
    };
  }
  if (err instanceof ApplicationFailure) {
    return { type: err.type ?? "", message: err.message, name: err.name };
  }
  if (err instanceof Error) {
    return { type: "", message: err.message, name: err.name };
  }
  return { type: "", message: String(err), name: "" };
}

async function deliverFailureNotice(
  acts: NodeActivities,
  init: AgentInit,
  input: ChatInput,
  err: unknown,
  cfg: Extract<ResolvedConfig, { ok: true }>,
): Promise<void> {
  const { type, message, name } = failureType(err);

  let text: string;
  if (
    /HarnessUnavailable/i.test(type) ||
    /HarnessUnavailable/i.test(name) ||
    /not installed|not signed/i.test(message)
  ) {
    text = noticeForFailure("harness-unavailable", { harness: cfg.spec.harness });
  } else if (/HarnessError/i.test(type) || /HarnessError/i.test(name)) {
    text = noticeForFailure("harness-error", { message });
  } else if (
    /timeout|heartbeat|cancelled|interrupt|died|killed/i.test(message) ||
    /Timeout/i.test(type)
  ) {
    text = noticeForFailure("interrupted");
  } else {
    text = noticeForFailure("harness-error", { message });
  }

  await acts.deliver({
    orgId: init.orgId,
    spaceId: init.spaceId,
    chatId: input.chatId,
    kind: "notice",
    text,
    key: `${input.key}:notice-fail`,
    clearEyesMessageId: input.messageId,
  });
}
