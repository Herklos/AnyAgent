# ADR 0006: Coordination: hierarchy assigns, groups may opt into claims

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

The existing org routes work `Human ↔ Primary → HQ chiefs → specialists` (`anytype-agents/SKILL.md`, "Typical
hierarchy"; "Do not bypass a chief to task their specialists unless the docs explicitly allow it"). Anytype merges
concurrent edits, so two agents writing `assignee` at the same time while offline could both believe they own a task.
The owner chose **mixed**: hierarchy by default, claims where a group allows them.

## Decision

1. **One writer per field.** An `aa_task`'s `lead` alone writes `assignee`, `done` and `cancelled`. The `assignee`
   alone writes `in_progress`, `review` and `result`. Agents never set themselves as assignee.
2. **Claims are opt-in** per `aa_group` (`claims: true`). An eligible agent sends a `claim(taskId)` **Temporal update**
   to the lead's workflow. A workflow handles updates one at a time, so exactly one claim per task wins. The lead's
   node then writes `assignee` and posts a notice. Losers get a refusal with the winner's handle.
3. If the lead is unavailable (no live workflow and the claim deadline passes), the claim fails; nothing is assigned
   by default.

## Consequences

- No double assignment in either mode.
- Claims add latency (one update round trip) and depend on Temporal, which is already a dependency.
- The rule "only the lead assigns" must be enforced in the node, not trusted to the model: the egress activity refuses
  an `assignee` write from a non-lead agent.

## Extension points

- Eligibility for claims (`claimable_by`: members, a list, a skill tag) is data on the group.

## Not generalised

- No auctions, bidding or load balancing in v0.
