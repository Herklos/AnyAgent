/**
 * Pure helpers for approval chat text, summary and risk (WP3).
 */

import type { PermissionKind } from "./permission.js";

export type ApprovalRiskLevel = "low" | "medium" | "high";

export interface ApprovalSummaryInput {
  toolName: string;
  kind?: PermissionKind;
  title?: string;
  rawInput?: unknown;
}

const MAX_CMD = 300;

export function riskForKind(kind: PermissionKind | undefined): ApprovalRiskLevel {
  if (kind === "execute" || kind === "delete") return "high";
  if (kind === "edit" || kind === "move") return "medium";
  return "low";
}

/** Summarise a tool call for the approval object/chat. Never includes file contents. */
export function summariseAction(input: ApprovalSummaryInput): string {
  const kind = input.kind ?? "other";
  const name = input.title || input.toolName || "tool";
  if (kind === "execute") {
    const cmd = (input.rawInput as { command?: unknown } | undefined)?.command;
    if (typeof cmd === "string") {
      const truncated = cmd.length > MAX_CMD ? `${cmd.slice(0, MAX_CMD)}…` : cmd;
      return `run \`${truncated}\``;
    }
    return `run ${name}`;
  }
  if (kind === "edit" || kind === "delete" || kind === "move") {
    const path =
      (input.rawInput as { path?: unknown } | undefined)?.path ??
      (input.rawInput as { file_path?: unknown } | undefined)?.file_path;
    if (typeof path === "string") return `${kind} ${path}`;
    return `${kind} via ${name}`;
  }
  if (kind === "fetch") {
    const url = (input.rawInput as { url?: unknown } | undefined)?.url;
    if (typeof url === "string") return `fetch ${url}`;
    return `fetch via ${name}`;
  }
  return `${kind} via ${name}`;
}

export function formatApprovalChatNotice(opts: {
  handle: string;
  summary: string;
  risk: ApprovalRiskLevel;
  expiresAtIso: string;
  objectId?: string;
}): string {
  const link = opts.objectId ? ` Object: ${opts.objectId}` : "";
  return `⏳ Approval needed: @${opts.handle} wants to ${opts.summary}. Risk: ${opts.risk}. React ✅ to allow or ❌ to deny. Expires ${opts.expiresAtIso}.${link}`;
}

export function formatDecisionNotice(
  status: "approved" | "denied" | "expired",
  decidedBy: string,
): string {
  if (status === "approved") return `✅ approved by ${decidedBy}`;
  if (status === "denied") return `❌ denied by ${decidedBy}`;
  return `⌛ expired, denied`;
}

/** Encode chatId/messageId into aa_message. */
export function encodeApprovalMessageRef(chatId: string, messageId: string): string {
  return `${chatId}/${messageId}`;
}

export function decodeApprovalMessageRef(
  ref: string,
): { chatId: string; messageId: string } | undefined {
  const i = ref.indexOf("/");
  if (i <= 0 || i === ref.length - 1) return undefined;
  return { chatId: ref.slice(0, i), messageId: ref.slice(i + 1) };
}
