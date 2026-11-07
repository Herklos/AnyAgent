# AgentCore

The workflow-side message queue and turn loop for one agent ([ADR 0019](../adr/0019-own-workflow-core-behind-a-seam.md)).
v0 ships `createOwnCore` behind the `AgentCore` interface. A different implementation (for example the npm harness) can
replace it without touching the gateway or node if it passes `runCoreContract`.

## Interface

Constants: `anyagent.chat` (update), `anyagent.close` (signal), `anyagent.status` / `anyagent.rotation` (queries).

```ts
createOwnCore(opts?: { rotateAfterAccepted?: number }): AgentCore  // default 1500
interface AgentCore { run(handler: TurnHandler): Promise<void> }
```

Workflow-safe: no Node imports, no `zod`, no `Date`, no `Math.random`.

## Behaviours

1. **Update `anyagent.chat`.** Rejects malformed input with non-retryable `BadInput`; rejects after close with
   non-retryable `AgentClosed`. Admits and returns an `Admission` at once (does not wait for the turn).
   Tests: T-WP3-01, T-WP3-08, T-WP3-08b
2. **Dedupe by `key`.** A key already admitted in this run returns `duplicate` with the original turn number and queues
   nothing.
   Tests: T-WP3-02, T-WP3-07
3. **Order.** Turns run one at a time, in admission order. `opened` when idle with an empty queue, else `queued`. Turn
   numbers increase by one per admitted message.
   Tests: T-WP3-03, T-WP3-06
4. **A failing turn does not stop the loop.** The handler's rejection is caught, counted (`failed` on status), and the
   next message runs.
   Tests: T-WP3-09
5. **Close.** Signal `anyagent.close` sets closing: new messages are rejected; the in-flight turn finishes; queued
   messages still run; then `run` returns after `allHandlersFinished`.
   Tests: T-WP3-08, T-WP3-08b
6. **Queries.** `status` returns `CoreStatus`; `rotation` returns `RotationHint` whose `continueAsNewSuggested` is true
   when Temporal suggests it or `accepted >= rotateAfterAccepted`. Queries never change state.
   Tests: T-WP3-04, T-WP3-05, T-WP3-10
7. **Determinism.** No clock, randomness or I/O in this module.
   Tests: T-WP3-11
8. **Approval gate (v1).** Optional `approvals: true` registers updates `anybot.permission` and `anybot.decision` with an `ApprovalBook`. Permission waits for a decision or TTL; expiry denies once. Status lists `pendingApprovals`; rotation `idle` is false while any are pending.
   Tests: T-V1-WP2-03, T-V1-WP2-04, T-V1-WP2-05
9. **Repeated permission id.** A second `permission` update with the same `requestId` shares one book entry and one decision.
   Tests: T-V1-WP2-06
10. **Unknown decision.** `anybot.decision` for an unknown id fails non-retryable `UnknownApproval`; a second decision after resolve is ignored.
    Tests: T-V1-WP2-07
11. **Concurrent permissions.** Two pending requests can be decided in either order.
    Tests: T-V1-WP2-08
12. **Responsiveness.** Status, rotation and close remain available while a permission update is in flight; close drains after the turn.
    Tests: T-V1-WP2-09

## How to add an implementation

1. Implement `AgentCore` (and the same update / signal / query names).
2. Provide a fixture workflow that calls `core.run(handler)` with a controllable activity stub.
3. Run `runCoreContract({ env, workflowsPath })` from `packages/workflows/test/core.contract.ts`.
