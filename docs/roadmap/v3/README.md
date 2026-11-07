# v3 work pack: autonomy

Build plan for release **v3** of [../../ROADMAP.md](../../ROADMAP.md). Same format and rules as the [v0 pack](../v0/README.md) (read its README first), the [v1](../v1/README.md) and [v2](../v2/README.md) packs. **v2 must be released** (its report exists and its acceptance passed) before v3 starts.

## The product slice

Agents act on their own **within limits people set**. They can create and manage more of the org (agents in draft, groups they lead, their reports' schedules and their own triggers) only where a permission says so, and anything on the "ask" list waits for a person. A **decision model** (local or cloud) can answer routine approval requests and escalates when unsure. The outside world can wake an agent
(webhooks, an object changing, a chat pattern). In a group that opts in, agents can **claim** ready tasks without two ever taking the same one.

**Out of scope for v3:** computer use (cua, [ADR 0016](../../adr/0016-computer-use-with-cua.md), a separate piece of work after v3), `any` as a backend (driven by its own signals), mid-turn steering, memory and skills, verified gates at a commit, more gateway sources (email, RSS), a high-availability gateway, a multi-approver quorum, `remember` on approvals.

## Definition of done

The roadmap's v3 "Done when" and [WP6](WP6-acceptance-and-release.md) pass, every work package's achievements are ticked in [STATUS.md](STATUS.md) with evidence, and a `REPORT.md` is written.

## Work packages

| WP | Title | Depends on | Size (est.) |
| --- | --- | --- | --- |
| [WP1](WP1-start-gate-and-spikes.md) | Start gate: carry-over, spikes 013 and 015 (the evaluation set and the permission table) | v2 released | 1 week |
| [WP2](WP2-org-permissions.md) | Org permissions in full ([ADR 0013](../../adr/0013-agent-permissions-over-the-org.md)) | WP1 | 1.5 weeks |
| [WP3](WP3-decision-model.md) | The decision model and `auto` mode ([ADR 0015](../../adr/0015-decision-model-for-approvals.md)) | WP1, WP2 | 1.5 weeks |
| [WP4](WP4-triggers.md) | Triggers: webhooks, object changes, chat patterns | WP2 | 1.5 weeks |
| [WP5](WP5-claims.md) | Claims in an opted-in group ([ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md)) | v2 | 4–5 days |
| [WP6](WP6-acceptance-and-release.md) | End-to-end acceptance and release | all | 1 week |

```
v2 ─ WP1 ─ WP2 ─┬─ WP3 ─┐
 │               └─ WP4 ─┤
 └─ WP5 ─────────────────┴─ WP6
```

## What is different from v2

- **Schema version `0.4.0`**, additive, and **assembled from three packages** (WP2 adds `aa_effort`, WP3 the decision fields and `auto`, WP4 `aa_trigger`); the migration step is released only complete, and `anyagent migrate` stays idempotent while it is being built: `aa_trigger`, and on `aa_agent` `aa_decision_model`, `aa_approval_criteria`, `aa_effort`; on `aa_settings` `aa_decision_model`, `aa_approval_criteria`; `aa_approval_mode` gains `auto`. `aa_permissions_ask` entries start to work (they create approvals).
- **Security posture.** v3 is the release where an outside party (a webhook sender, a model's verdict, a prompt injection through a payload) can influence what runs. Every package has adversarial tests; any failure of the kind "something not authorised ran" **stops the release**.
- **The decision model never fails open** and never replaces the floor ([ADR 0015](../../adr/0015-decision-model-for-approvals.md)). Its quality is measured (WP1, WP3) before `auto` may be enabled for an agent.
- **Live-test variables:** `ANYAGENT_LIVE_DECISION_LOCAL=1` (a local `llama-server` as decision model), `ANYAGENT_LIVE_DECISION_CLOUD=1` (a cloud endpoint), `ANYAGENT_LIVE_WEBHOOK=1` (a real signed webhook from a sender the owner controls).
- **Open questions that touch v3:** [Q5](../../OPEN-QUESTIONS.md) stays "no" (object discussions do not wake agents); `chat_pattern` triggers are the supported way to react to chat text.
