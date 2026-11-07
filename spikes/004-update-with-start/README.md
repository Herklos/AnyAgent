# Spike 004: update-with-start for the event gateway

**Question.** Does Temporal's update-with-start (`startUpdateWithStart`, `workflowIdConflictPolicy: USE_EXISTING`, `waitForStage: ACCEPTED`, `updateId` = idempotency key) behave as [ADR 0011](../../docs/adr/0011-event-gateway.md) assumes for the gateway?

**Depends on.** A Temporal test server (or self-hosted/Cloud). WP3 fixture workflow (`coreFixtureWorkflow`).

## Five checks

| # | Claim | Result |
| --- | --- | --- |
| (a) | Starts a missing workflow and delivers the update | **pass** when Temporal env available (T-WP5-05) |
| (b) | Delivers to a running workflow (`USE_EXISTING`) | **pass** (same) |
| (c) | Drops a repeated `updateId` within a run | **pass** via WP3 contract + gateway key dedupe; Temporal rejects or core returns `duplicate` |
| (d) | Recognisable error when closing; retry starts a new run | **pass** when Temporal env available (T-WP5-06 ×20); must `await handle.result()` after ACCEPTED |
| (e) | `waitForStage: ACCEPTED` returns before the turn ends | **pass** — but validator rejection is **invisible** at ACCEPTED; only at `handle.result()` |

## Minimum Temporal server version

| Environment | Version | Notes |
| --- | --- | --- |
| `@temporalio/testing` TestWorkflowEnvironment (SDK 1.24.0) | Temporal CLI bundled server (**Server 1.32.2**, CLI 1.10.0 / UI 2.56.1 as printed by CI) | Used in CI / local WP5 Temporal tests |
| Self-hosted / Temporal Cloud | **NOT RUN** in this environment | Re-run against a self-hosted server and Cloud API key before WP8; record the lowest self-hosted version that supports Update-With-Start MultiOperation |

**Finding:** with `waitForStage: "ACCEPTED"`, `startUpdateWithStart` returns a handle even when the update validator rejects with `AgentClosed`. The rejection surfaces as `WorkflowUpdateFailedError` (cause `ApplicationFailure` type `AgentClosed`) only from `await handle.result()`. Committing the cursor before that await silently loses messages during close/rotation.

If Temporal is unavailable, WP5 Temporal tests are **skipped** with the reason and this spike is **NOT RUN** for (a)–(e) on a real server — that **blocks WP8**.

## What this spike did not prove

- Temporal Cloud API-key auth path
- Exact minimum self-hosted server binary version outside the SDK test server
- Multi-org load or HA of the gateway process

## How to run

```bash
pnpm --filter @anyagent/gateway test
# Temporal cases live in packages/gateway/test/temporal.delivery.test.ts
```
