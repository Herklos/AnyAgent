import type { AgentSpec } from "./agent-spec.js";

export function isAllowedAuthor(opts: {
  spec: Pick<AgentSpec, "allowedAuthors">;
  authorId: string;
  ownerIds: string[];
  agentAccountId?: string;
}): boolean {
  if (opts.agentAccountId && opts.authorId === opts.agentAccountId) return false;
  if (opts.spec.allowedAuthors.length === 0) {
    return opts.ownerIds.includes(opts.authorId);
  }
  return opts.spec.allowedAuthors.includes(opts.authorId);
}

/** Pure check when the backend exposes last modifier. */
export function lastModifierAcceptable(
  modifiedById: string | undefined,
  ownerIds: string[],
  allowedAuthors: string[],
): boolean {
  if (!modifiedById) return true;
  if (ownerIds.includes(modifiedById)) return true;
  if (allowedAuthors.includes(modifiedById)) return true;
  return false;
}
