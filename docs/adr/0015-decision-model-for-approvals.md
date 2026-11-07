# ADR 0015: A decision model (local or cloud) judges approvals in `auto` mode, racing a person

- Status: accepted (owner's request, 2026-11-06: "Plan to use a decision model (local or cloud) for approvals")
- Date: 2026-11-06

## Context

[ADR 0008](0008-approvals-objects-and-reactions.md) defines approval modes `read_only`, `ask`, `auto` and `full`, and
leaves `auto`'s judge unspecified. The harness anybot builds on ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md))
has an **auto mode**: named criteria sets with `approve_when`, `deny_when`, `escalate_when`, `min_confidence` and
`escalate_if_irreversible_above`, judged by a pluggable `AutoModeEvaluator` that returns `approve`, `deny` or
`escalate`. The gate "races it against a human and cancels the loser" (`agent-protocol/agent-interface.ts`, lines
176–181 and 285, upstream `9eaf026`; [research](../research/temporal-agent-harness.md)). Upstream ships an evaluator for
its own Jev service only. Michel plans the same seam with "any configured model (cheap, local or Apple) instead of only
Jev", and "anything unclear goes to a human; nothing fails open" (Michel `docs/PLAN.md`, line 574).

## Decision

1. **anybot's evaluator calls a decision model through an activity.** The workflow's `AutoModeEvaluator` runs the
   activity `judgeApproval` on a node that has the configured endpoint. The activity sends the tool name, a summary of
   the input, the agent's role, the task and the criteria set to an `{endpoint, model}`
   ([ADR 0014](0014-model-endpoints-local-and-cloud.md)). It asks for a JSON verdict
   `{verdict, confidence, irreversibility, reason}` with a JSON schema. The model can be local (`llama-server` on a node)
   or cloud.
2. **Configuration is data.** `aa_settings.aa_decision_model` (`<endpointId>/<model>`) is the default, and
   `aa_agent.aa_decision_model` overrides it. Criteria sets are an `aa_prompt` of kind `approval_criteria` whose body is
   YAML in the harness's `AutoApprovalCriteria` shape, linked from the agent (`aa_approval_criteria`) or from the
   settings as the default.
3. **It races a person; it never replaces the floor.** In `auto` mode, a gated call creates the `aa_approval` object and
   chat message as in `ask`, and the evaluator runs at the same time. The first decision wins: the model's
   approve/deny, or an approver's ✅/❌. An `escalate` verdict leaves the decision to people.
4. **It never fails open.** A timeout, an unreachable endpoint, invalid JSON, confidence below `min_confidence`, or
   irreversibility above `escalate_if_irreversible_above` all become `escalate`.
5. **Hard floors no model can pass**, checked by `preDecision` before the evaluator runs:
   - computer use on a person's own desktop ([ADR 0016](0016-computer-use-with-cua.md));
   - writes covered by `aa_permissions_ask` ([ADR 0013](0013-agent-permissions-over-the-org.md));
   - anything the agent's harness provider requires a human to confirm (Michel's `docs/research/provider-terms.md`
     notes this for Gemini's Computer Use API).
6. **Recorded like any decision.** `aa_decided_by` = `model:<endpointId>/<model>`, plus the verdict, confidence and
   reason in the approval object's body. Approvers can review model decisions in the `Approvals – By model` query.

## Consequences

- Routine calls stop waiting for people without giving up the human path: a person can still answer first.
- A local decision model keeps tool inputs on the private network. A cloud model sends them to that provider, so the
  setup guide says so.
- One more activity per gated call in `auto` mode. Its latency is bounded by the activity timeout (default 30 s), after
  which it escalates.
- The decision model is a security component. It is pinned per deployment, and changing it is an edit people can see.

## Extension points

- Evaluator kinds: `model` (v0); `rules` (a pure function over the criteria) and `jev` (upstream's) are registry
  entries.
- Specialised small models (for example cua's CUA-S1 family, "small, specialized System 1 models for computer use",
  `trycua/cua` README) could judge computer-use steps later. They are not approval judges today.

## Not generalised

- No multi-model voting or quorum.
- No learning from past decisions in v0.
