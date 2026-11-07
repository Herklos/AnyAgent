# Spike 006 — approvals half (v1 WP2)

Measured against `approvalFixtureWorkflow` on Temporal `TestWorkflowEnvironment` (SDK test server), own AgentCore + ApprovalBook.

## Method

- One open turn held with a `slow` chat update.
- One or three `anybot.permission` updates gated with `needsApproval: true`, then `anybot.decision` approve/deny, or TTL expiry.
- History length sampled via `status.historyLength` before/after (workflow query).

## Results (2026-11-07)

| Scenario | Approx. events added | Notes |
| --- | --- | --- |
| One approval (request + decision approve) | ~8–14 | createApproval + recordDecision activities + updates |
| One expiry (TTL) | ~8–14 | sleep timer + recordDecision(expired) |
| Three approvals in one turn | ~24–40 | linear in count; under 30 events/approval stop condition |

Exact CI numbers vary with worker bundle noise; all runs stayed **under 30 history events per approval** (pack stop condition).

## What this did not prove

- Live Anytype object create/react path (WP3).
- Cost on Temporal Cloud.
- Concurrent approvals under production gateway load.
