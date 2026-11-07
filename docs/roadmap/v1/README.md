# v1 work pack: a safe, proactive assistant

Build plan for release **v1** of [../../ROADMAP.md](../../ROADMAP.md). Same format and rules as the [v0 pack](../v0/README.md); read that README first (its rules 1 to 10, conventions and glossary apply
unchanged). This page gives what is different. **v0 must be released** (its `docs/roadmap/v0/REPORT.md` exists and its acceptance passed) before v1 starts.

## The product slice

The owner can let an agent do real work **without free rein**: a risky tool call waits for a ✅ or ❌ from an approver in Anytype. The agent can work while the owner is away, on a schedule. It can run on a
local or cloud model through any OpenAI-compatible endpoint. The owner can stop a running turn with `/stop`, see what every agent is doing, and one deployment can serve two orgs. v0's acceptance also passes on Temporal Cloud
and on a self-hosted any-sync network.

**Out of scope for v1:** groups and @mentions, tasks, more than one node, separate gateway and node processes, shared prompts, org permissions beyond v0's, the decision model (`auto`), triggers, claims, `any` as a backend,
computer use, `remember` ("always allow this") on approvals, more than one approver required, streaming replies.

## Definition of done

The roadmap's v1 "Done when" and [WP8](WP8-acceptance-and-release.md) pass, every work package's achievements are ticked in [STATUS.md](STATUS.md) with evidence, and a `docs/roadmap/v1/REPORT.md` is written.

## Work packages

| WP | Title | Depends on | Size (est.) |
| --- | --- | --- | --- |
| [WP1](WP1-carryover-and-gate-decision.md) | v0 carry-over and the approval-gate decision (ADR 0019 criteria) | v0 released | 3–4 days |
| [WP2](WP2-approval-gate.md) | The approval gate in the core, `ask` mode, the permission path (spike 006, approvals half) | WP1 | 1–1.5 weeks |
| [WP3](WP3-approvals-in-anytype.md) | Approvals in Anytype: objects, reactions, approvers, expiry (spike 011 for approvers) | WP2 | 1 week |
| [WP4](WP4-schedules.md) | Schedules: `aa_schedule`, Temporal Schedules, `ScheduleKick` | v0 | 4–5 days |
| [WP5](WP5-endpoints-and-openai-harness.md) | Model endpoints and the OpenAI-compatible harness (spike 007, second half) | v0 | 1 week |
| [WP6](WP6-stop-status-notices.md) | `/stop`, `anyagent status`, notices and usage | v0 (WP2 for pending approvals) | 4–5 days |
| [WP7](WP7-multi-org-and-variants.md) | Two orgs, Temporal Cloud, self-hosted any-sync (spike 012) | v0 | 1 week |
| [WP8](WP8-acceptance-and-release.md) | End-to-end acceptance and release | all | 4–5 days |

```
v0 ─ WP1 ─ WP2 ─ WP3 ───────────────┐
 ├─ WP4 ────────────────────────────┤
 ├─ WP5 ────────────────────────────┼─ WP8
 ├─ WP6 (after WP2 for approvals) ──┤
 └─ WP7 ────────────────────────────┘
```

WP4, WP5 and WP7 are independent of the approval chain and can run in parallel with it.

## What is different from v0

- **Baseline.** The v0 pack's names (`Backend`, `AgentCore`, `HarnessSession`, `decidePermission`, the packages under `packages/`) are the contract. If the built code differs, follow the code and list each difference in [STATUS.md](STATUS.md).
- **Schema changes are additive and versioned** ([ADR 0009](../../adr/0009-new-minimal-versioned-schema.md)): v1 writes schema version `0.2.0`; `anyagent init` upgrades a v0 space in place and `doctor` reports the version. Never remove or rename a v0 field.
- **Approval modes:** `aa_approval_mode` gains `ask`. A harness without a permission callback ([ADR 0020](../../adr/0020-harness-adapter-kinds.md): Mistral Vibe in headless mode) is refused `ask` at `agent create`, by `doctor`, and at run time.
- **New live-test variables:** `ANYAGENT_LIVE_LLAMA=1` (a `llama-server` on the node), `ANYAGENT_LIVE_OPENAI_COMPAT=1` (a cloud endpoint with a key in the environment), `ANYAGENT_LIVE_TEMPORAL_CLOUD=1`, `ANYAGENT_LIVE_SELFHOSTED_NET=1`.
- **Open questions that touch v1:** none are open; [Q13](../../OPEN-QUESTIONS.md) (one final message, no streaming) stays as decided.
- **Pins.** Engine pins follow the outcome of WP1 ([ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md)); until then they are unchanged.
