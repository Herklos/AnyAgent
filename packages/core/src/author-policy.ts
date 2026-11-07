import type { AgentSpec } from "./agent-spec.js";

export function isAllowedAuthor(opts: {
  spec: Pick<AgentSpec, "allowedAuthors">;
  authorId: string;
  ownerIds: string[];
  /** Required: the agent's own account is never allowed (loop guard). */
  agentAccountId: string;
}): boolean {
  if (opts.authorId === opts.agentAccountId) return false;
  if (opts.spec.allowedAuthors.length === 0) {
    return opts.ownerIds.includes(opts.authorId);
  }
  return opts.spec.allowedAuthors.includes(opts.authorId);
}

export type ModifierCheck =
  | { result: "ok" }
  | { result: "not-checked" }
  | { result: "unknown-modifier-refused" }
  | { result: "forbidden-modifier" };

/**
 * When the backend can show who edited (`capable: true`), a missing modifier
 * fails closed. When it cannot (`capable: false`), the check is skipped
 * (`not-checked`) so doctor can warn.
 */
export function lastModifierAcceptable(opts: {
  capable: boolean;
  modifiedById: string | undefined;
  ownerIds: string[];
  allowedAuthors: string[];
}): ModifierCheck {
  if (!opts.capable) return { result: "not-checked" };
  if (!opts.modifiedById) return { result: "unknown-modifier-refused" };
  if (opts.ownerIds.includes(opts.modifiedById)) return { result: "ok" };
  if (opts.allowedAuthors.includes(opts.modifiedById)) return { result: "ok" };
  return { result: "forbidden-modifier" };
}
