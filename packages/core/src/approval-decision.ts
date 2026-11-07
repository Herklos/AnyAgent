/**
 * Pure decision rule for approval reactions (WP3 / ADR 0008).
 * Deny wins when both ✅ and ❌ are present from eligible approvers.
 */

export interface ReactionSnapshot {
  /** Emoji → participant ids who currently have that reaction. */
  reactions: Record<string, string[]>;
}

export interface DecideApprovalInput {
  reactions: Record<string, string[]>;
  /** Current resolved approver participant ids. */
  approvers: string[];
  /** Agent account ids — never decide. */
  agentAccounts: string[];
}

export type DecideApprovalResult =
  | { kind: "none" }
  | { kind: "approved" | "denied"; decidedBy: string };

const APPROVE = "✅";
const DENY = "❌";

/**
 * Compute a decision from current reactions.
 * - Only ✅ / ❌ from current approvers who are not agent accounts count.
 * - One kind → that decision; both → deny wins.
 * - Decider: first approver id in `approvers` order who holds the winning emoji
 *   (reaction timestamps are not on ChatMessage; id order is the stable rule).
 */
export function decideFromReactions(input: DecideApprovalInput): DecideApprovalResult {
  const agents = new Set(input.agentAccounts);
  const approverSet = new Set(input.approvers.filter((id) => !agents.has(id)));

  const yes = (input.reactions[APPROVE] ?? []).filter((id) => approverSet.has(id));
  const no = (input.reactions[DENY] ?? []).filter((id) => approverSet.has(id));

  if (no.length > 0) {
    const decidedBy = input.approvers.find((id) => no.includes(id)) ?? no[0]!;
    return { kind: "denied", decidedBy };
  }
  if (yes.length > 0) {
    const decidedBy = input.approvers.find((id) => yes.includes(id)) ?? yes[0]!;
    return { kind: "approved", decidedBy };
  }
  return { kind: "none" };
}

/**
 * Status-edit path: only when the backend shows who edited (`modifiedById`).
 * Treat an edit to approved/denied by an eligible approver like a reaction.
 */
export function decideFromStatusEdit(input: {
  status: string;
  modifiedById: string | undefined;
  approvers: string[];
  agentAccounts: string[];
}): DecideApprovalResult {
  if (!input.modifiedById) return { kind: "none" };
  if (input.status !== "approved" && input.status !== "denied") return { kind: "none" };
  const agents = new Set(input.agentAccounts);
  if (agents.has(input.modifiedById)) return { kind: "none" };
  if (!input.approvers.includes(input.modifiedById)) return { kind: "none" };
  return {
    kind: input.status === "approved" ? "approved" : "denied",
    decidedBy: input.modifiedById,
  };
}
