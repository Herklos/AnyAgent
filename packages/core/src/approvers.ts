/**
 * Spike 011: resolve who may decide approvals.
 * Approvers must be people (never agent accounts). Empty list → owners.
 */

export interface ResolveApproversInput {
  /** Comma-separated participant ids from aa_settings.aa_approvers (may be empty). */
  settingsApprovers: string;
  /** Space owner participant ids. */
  owners: string[];
  /** Known agent account ids (refused as approvers). */
  agentAccounts: string[];
  /** Optional: participant ids currently in the space. */
  members?: string[];
}

export interface ResolveApproversResult {
  approvers: string[];
  refused: Array<{ id: string; reason: string }>;
}

function splitIds(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveApprovers(input: ResolveApproversInput): ResolveApproversResult {
  const agents = new Set(input.agentAccounts);
  const members = input.members ? new Set(input.members) : undefined;
  const refused: Array<{ id: string; reason: string }> = [];
  const configured = splitIds(input.settingsApprovers);
  const candidates = configured.length > 0 ? configured : [...input.owners];

  const approvers: string[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (agents.has(id)) {
      refused.push({ id, reason: "agent-account" });
      continue;
    }
    if (members && !members.has(id)) {
      refused.push({ id, reason: "not-in-space" });
      continue;
    }
    approvers.push(id);
  }

  // Fallback: if everything was refused and we had a configured list, try owners.
  if (approvers.length === 0 && configured.length > 0) {
    for (const id of input.owners) {
      if (agents.has(id)) {
        refused.push({ id, reason: "agent-account" });
        continue;
      }
      if (members && !members.has(id)) {
        refused.push({ id, reason: "not-in-space" });
        continue;
      }
      if (!approvers.includes(id)) approvers.push(id);
    }
  }

  return { approvers, refused };
}
