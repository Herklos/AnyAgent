# ADR 0021: Approval gate stays on own AgentCore (do not adopt npm harness at v1)

- Status: **proposed** (implementing agent recommendation, 2026-11-07). Owner confirmation required before any pin change or new `@temporalio/agent-harness*` dependency. WP2 may proceed on the own gate while this is proposed, because the recommendation is outcome A.
- Date: 2026-11-07

## Context

[ADR 0019](0019-own-workflow-core-behind-a-seam.md) deferred the approval-gate implementation choice to v1, against the six criteria in [research/harness-vs-own-vs-framework.md](../research/harness-vs-own-vs-framework.md) §9. v0 shipped `createOwnCore` with measured history cost (~11.18 events / ~4.9 KB per message, spike 006). WP1 ran `scripts/harness-criteria.mjs --latest` against `@temporalio/agent-harness@0.4.0` and recorded the carry-over in [roadmap/v1/CARRYOVER.md](../roadmap/v1/CARRYOVER.md).

## Evidence (criteria)

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | SDK range / no deep import | **FAIL** | `0.4.0` still imports `@temporalio/common/lib/time.js`; breaks on SDK 1.25; adoption would keep forcing pin 1.24.0 |
| 2 | Public permission → gate | **FAIL** | No public host-side permission-request entry; ToolApproval types exist but the external bridge pattern remains `@internal` (Michel G37) |
| 3 | continue-as-new | **FAIL** (informational) | Not present in package; gateway rotation already covers idle runs |
| 4 | History ≤ 2× own core | **SKIP** | Spike not built — stopped because 1/2/5 failed |
| 5 | API stable across two minors | **FAIL** | Still `0.x` with minors 0.1–0.4 in days; experimental churn |
| 6 | `runCoreContract` on harness core | **SKIP** | Spike not built |

Early-exit rule (§9): any of 1, 2 or 5 failing → stay on own core.

## Decision (proposed)

1. **Outcome A — own gate.** Implement the v1 approval gate on `createOwnCore` (WP2), not behind `@temporalio/agent-harness`.
2. **Do not add** `@temporalio/agent-harness*` to the workspace until a future evaluation passes criteria 1, 2 and 5 (likely after upstream 1.0 and a deep-import fix).
3. **Pins.** Keep `@temporalio/*` at exact **1.24.0** for now (AGENTS.md rule 8). Moving the pin is the owner's call in a separate commit after this ADR is accepted; nothing in outcome A requires staying on 1.24.0 except caution.
4. **Revisit** when upstream tags 1.0 or publishes a release that clears criteria 1, 2 and 5; re-run `node scripts/harness-criteria.mjs --latest`.

## Consequences

- WP2 writes `ApprovalBook` + permission/decision updates on our core (~1–1.5 weeks as estimated).
- No experimental harness dependency in v1; history cost stays the own-core baseline.
- A later swap remains possible via the `AgentCore` seam if criteria flip.

## Extension points

- Second `AgentCore` implementation `harness` remains a registry slot for a future ADR if criteria pass.
- Gate module is separate from message admission (ADR 0019 extension points).

## Not generalised

- No agent framework; no automatic pin bump; no vendoring of the harness.
