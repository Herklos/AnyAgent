import { fileFloorReason, hardFloorReason } from "./floor/command-floor.js";

export type Mode = "read_only" | "full" | "ask";

export type PermissionKind =
  | "read"
  | "search"
  | "think"
  | "fetch"
  | "edit"
  | "delete"
  | "move"
  | "execute"
  | "other";

export interface PermissionRequest {
  toolName: string;
  kind?: PermissionKind;
  title?: string;
  rawInput?: unknown;
  home?: string;
}

export interface PermissionDecisionResult {
  allow: boolean;
  reason: string;
  /** ask mode: caller must consult the approval gate (not a hard deny). */
  needsApproval?: boolean;
}

/** Kinds allowed without asking in read_only and ask. Deliberately excludes `fetch`. */
export const READ_ONLY_KINDS = new Set<PermissionKind>(["read", "search", "think"]);

/**
 * Host permission decision. Floor first in every mode; then mode rules.
 * In `ask`, safe kinds allow; everything else (including fetch) sets needsApproval.
 */
export function decidePermission(mode: Mode, req: PermissionRequest): PermissionDecisionResult {
  const cmd = (req.rawInput as { command?: unknown } | undefined)?.command;
  const command = req.kind === "execute" && typeof cmd === "string" ? cmd : undefined;

  const hard =
    command !== undefined
      ? hardFloorReason(command, { home: req.home })
      : fileFloorReason(req.toolName, req.rawInput);
  if (hard) {
    return { allow: false, reason: hard };
  }

  if (mode === "read_only") {
    if (!req.kind || !READ_ONLY_KINDS.has(req.kind)) {
      return { allow: false, reason: "read-only agent" };
    }
    return { allow: true, reason: "read-only allow" };
  }

  if (mode === "ask") {
    if (req.kind && READ_ONLY_KINDS.has(req.kind)) {
      return { allow: true, reason: "ask allow (safe kind)" };
    }
    return {
      allow: false,
      reason: "needs approval",
      needsApproval: true,
    };
  }

  return { allow: true, reason: "full allow" };
}
