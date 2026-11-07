# v1 WP2: the approval gate in the core, and `ask` mode

**Goal.** In `ask` mode a harness permission request pauses the turn until a person decides, or the request expires and is denied, without blocking status queries, `close` or other updates, and without ever running a call twice. This package builds the gate
and the permission path inside Temporal; WP3 connects it to Anytype. It includes the approvals half of **spike 006**.

**Depends on:** WP1. **Unblocks:** WP3, WP6 (stopping a turn with a pending approval).

## Scope

In: the `ApprovalBook`, the gate module of the core, the `anyagent.permission` and `anyagent.decision` updates, `ask` in `decidePermission`, the node-side permission path (the activity asks the workflow), capability gating, expiry.
Out: Anytype objects and reactions (WP3), the decision model and `auto` (v3), `remember`, quorum of approvers.

## Read first

[ADR 0008](../../adr/0008-approvals-objects-and-reactions.md), [ADR 0020](../../adr/0020-harness-adapter-kinds.md) (capabilities), [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md) and ADR 0021 (WP1's outcome), `docs/specs/agent-core.md`,
[specs/agent-workflow.md](../../specs/agent-workflow.md) ("Permission and approvals"), and from v0: `packages/core/src/permission.ts`, `packages/workflows/src/core/`, `packages/node/src/activities/run-turn.ts`. Reference: Michel `packages/temporal/workflows/src/agent.ts` (`decide`, the per-request decision map).

## Files

Create: `packages/workflows/src/core/{approval-book.ts,approval.ts}`, tests under `packages/workflows/test/`, `spikes/006-agent-core/APPROVALS.md`.
Change: `packages/core/src/permission.ts` (mode `ask`), `packages/workflows/src/{contracts.ts,anyagent-workflow.ts}` (the two updates, the activity types `createApproval` and `recordDecision` declared here, implemented in WP3), `packages/node/src/activities/run-turn.ts` (the permission path),
`docs/specs/agent-core.md` and `docs/specs/agent-workflow.md`.
If ADR 0021 chose the harness, implement the same contract through the harness-backed core instead; the tests are identical.

## Design

- `ApprovalBook` (pure, no Temporal): `request({ requestId, toolName, summary, risk, expiresInMs })` creates a pending entry once per `requestId` (a second call returns the same entry); `decide(requestId, { approved, decidedBy, reason })` resolves it once (a second decision is ignored and
  reported as `already_decided`); `expire(requestId)`; `pending()`. Never reads a clock; expiry is driven by a workflow timer.
- **Mode `ask` for `decidePermission`:** the floor denies first (as in v0); kinds `read`, `search`, `think` are allowed without asking; everything else, including `fetch`, goes to the gate. `read_only` and `full` behave as in v0.
- **Update `anyagent.permission`** (from the node during a turn): input `{ requestId, toolName, kind?, title?, rawInput? }`, output `{ approved, reason? }`. The handler runs the pure pre-decision; if it does not decide, it asks for an approval: calls activity `createApproval`
  (idempotent by `requestId`, implemented in WP3), then waits until `anyagent.decision` arrives for that `requestId` or the timer expires; on expiry it calls `recordDecision(expired)` and returns denied with reason `expired`. A repeated `permission` update with the same `requestId`
  (an activity retry after a node crash) returns the same pending promise, so no second approval is created.
- **Update `anyagent.decision`** (from the gateway, WP3): input `{ requestId, approved, decidedBy, reason? }`; validator rejects an unknown `requestId` with a non-retryable `UnknownApproval`; the handler resolves the book and calls `recordDecision`.
- **Queries:** `anyagent.status` gains `pendingApprovals: [{ requestId, summary, risk, ageMs? }]` (no clock: `ageMs` is computed by the caller from the approval object's time) and `rotation.idle` is false while any approval is pending.
- **Concurrency:** the turn's activity stays running and heartbeats while it waits for the `permission` update to return; the workflow must stay responsive to `status`, `close`, `decision` and further `permission` updates (a harness may ask for two calls at once). The main loop never awaits the book.
- **TTL:** `tuning.approvalTtlMinutes` (default 30, must be less than `tuning.turnTimeoutMin`); `doctor` (WP3) checks the relation.
- **Capability gating:** `ask` requires `permissionCallbacks` ([ADR 0020](../../adr/0020-harness-adapter-kinds.md)). `resolveConfig` returns `ok: false, reason: "mode-unsupported"` for a harness without it, and the workflow posts the one notice.
- **Node side:** `runTurn`'s `onPermission` handler calls the `permission` update on its own workflow (`workflowId` known from the request) through a Temporal `Client` built in the node, and returns its answer to the harness; a denial's reason is passed back to the harness so the reply can say why.
  If the update call fails (Temporal down), the answer is deny with reason `approval service unavailable`; it never allows.

## Steps

1. `ApprovalBook` with unit tests.
2. Extend `decidePermission` for `ask`; extend its table test.
3. Core module `approval.ts`: register the two updates and wire the book and the timer; extend `CoreStatus` and the rotation hint; add the new behaviours (numbers 8 to 12) to `docs/specs/agent-core.md` and to `runCoreContract`.
4. Node permission path with a fake Temporal client in unit tests, then the real client in the integration tests.
5. Measure (spike 006, approvals half): history events and bytes per approval (request, decision, expiry) and the cost of three approvals in one turn; write `spikes/006-agent-core/APPROVALS.md`; add the number to the research note.
6. Update both specs.

## Tests

- T-V1-WP2-01 `ApprovalBook`: request once per id, repeated request returns the same entry; one decision wins; decide after expire is ignored; pending list order.
- T-V1-WP2-02 `decidePermission` in `ask`: reads allowed, edit, execute, fetch and other kinds gated, floor wins, unchanged `read_only` and `full` tables.
- T-V1-WP2-03 (Temporal) approve path: a turn with a gated call waits, a decision arrives, the turn continues, the harness sees allowed.
- T-V1-WP2-04 (Temporal) deny path, with the reason reaching the harness.
- T-V1-WP2-05 (Temporal, time skipping) expiry denies at the TTL and `recordDecision(expired)` is called once.
- T-V1-WP2-06 (Temporal) a repeated `permission` update with the same `requestId` creates one approval and returns one decision.
- T-V1-WP2-07 (Temporal) a `decision` for an unknown id fails with `UnknownApproval`; a second decision for a decided id is ignored.
- T-V1-WP2-08 (Temporal) two simultaneous requests are both pending, decided in either order, and `status` lists them while the turn is running.
- T-V1-WP2-09 (Temporal) `status`, `rotation` and `close` answer while an approval is pending; `rotation.idle` is false; close waits for the turn.
- T-V1-WP2-10 (Temporal) replay of a recorded history with approvals succeeds.
- T-V1-WP2-11 `ask` for a headless harness is refused with the notice, and nothing runs.
- T-V1-WP2-12 node path: Temporal unavailable means deny, never allow; the harness receives the reason.
- T-V1-WP2-13 `runCoreContract` (extended) passes on the implementation chosen in WP1.

## Checks

```bash
pnpm --filter @anyagent/workflows test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/core test
grep -rn "Date\.\|Math\.random\|from \"node:" packages/workflows/src   # expect: no output
pnpm check
```

## Achievements

- [ ] An `ask`-mode turn pauses on a gated call and resumes only on a decision or expires into a denial, in every Temporal test above.
- [ ] No path allows a call without a decision: Temporal failure, an unknown id, a double decision and expiry all deny or are ignored.
- [ ] The workflow stays responsive while approvals are pending; rotation never happens with one pending.
- [ ] Events per approval are measured and recorded.
- [ ] The two specs match the code.

## Stop and ask when

The harness adapters cannot deliver permission requests while the turn is running (then `ask` cannot work for that harness); the update handler cannot be made responsive during the wait with the chosen core; the measured cost per approval is more than 30 events.
