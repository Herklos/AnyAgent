# WP3: the `AgentCore` seam and our own core

**Goal.** The workflow-side machinery of one agent (admit a message, queue it, run turns in order, answer status and rotation queries, close cleanly) exists as a small,
deterministic, well-tested module behind an interface, so that a different implementation (the `@temporalio/agent-harness`, later, if [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md)'s criteria are met)
could replace it without touching anything else. Includes **spike 006** (the part that needs no approval gate): it measures history events per message.

**Depends on:** WP0. **Unblocks:** WP5, WP6.

## Scope

In: the interface, the pure admission logic, the Temporal wiring, the contract test suite, the measurement, `docs/specs/agent-core.md`.
Out: the approval gate and auto mode (v1, v3), steering, idle close, any use of `@temporalio/agent-harness`, any `zod` or Node import inside workflow code.

## Read first

[ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md), [research/harness-vs-own-vs-framework.md](../../research/harness-vs-own-vs-framework.md) (sections 1, 5, 9),
[specs/agent-workflow.md](../../specs/agent-workflow.md) (inputs, "A turn", "Rotation"), [ADR 0011](../../adr/0011-event-gateway.md) (rotation, update-with-start),
[AGENTS.md](../../../AGENTS.md) rule 4 (determinism). Reference only (do not copy blindly, MIT, attribute if you take anything): upstream's runner,
`temporal-community/temporal-agent-harness` `typescript/packages/core/src/harness/agent-workflow.ts` lines 417 to 660 and `agent-protocol/agent-interface.ts`.

## Files

Create: `packages/workflows/src/core/{types.ts,admission.ts,own-core.ts,index.ts}`, `packages/workflows/test/{admission.test.ts,core.contract.ts,own-core.test.ts}`,
`packages/workflows/test/fixtures/core-workflow.ts`, `e2e/support/temporal.ts`, `docs/specs/agent-core.md`, `spikes/006-agent-core/README.md`.
Change: `docs/research/harness-vs-own-vs-framework.md` (add a "Measured" section), `docs/SPIKES.md` (006).
Must not change: ADRs (if the numbers argue against ADR 0019, write that in STATUS.md and stop).

## The interface (workflow-safe: no Node imports, no `zod`, no `Date`, no `Math.random`)

```ts
export const CHAT_UPDATE = "anyagent.chat";        export const CLOSE_SIGNAL = "anyagent.close";
export const STATUS_QUERY = "anyagent.status";     export const ROTATION_QUERY = "anyagent.rotation";

export interface ChatInput { key: string; chatId: string; messageId: string; authorId: string; text: string; replyTo?: string }
export type Disposition = "opened" | "queued" | "duplicate";
export interface Admission { disposition: Disposition; turnNumber: number }
export interface CoreStatus { state: "idle" | "running" | "closing"; queued: number; turns: number; accepted: number; currentKey?: string; historyLength: number; continueAsNewSuggested: boolean }
export interface RotationHint { continueAsNewSuggested: boolean; historyLength: number; idle: boolean; accepted: number }
export type TurnHandler = (input: ChatInput, ctx: { turnNumber: number }) => Promise<void>;
export interface AgentCore { run(handler: TurnHandler): Promise<void> }          // registers handlers, loops until closed and drained
export function createOwnCore(opts?: { rotateAfterAccepted?: number }): AgentCore  // default 1500
```

## Behaviour (the contract; `docs/specs/agent-core.md` states it in prose)

1. **Update `anyagent.chat`.** The validator rejects malformed input (not an object, `key` or `text` missing or not a string) with a non-retryable `BadInput` failure, and rejects
   everything once close was requested with a non-retryable `AgentClosed` failure. The handler admits the message and **returns at once** with an `Admission`; it does not wait for the turn.
2. **Dedupe by `key`.** A key already admitted in this run returns `duplicate` with the original turn number and queues nothing. (Temporal itself drops a repeated update id.)
3. **Order.** Turns run one at a time, in admission order. `disposition` is `opened` when the core was idle with an empty queue, else `queued`. Turn numbers increase by one per admitted message.
4. **A failing turn does not stop the loop.** The handler's rejection is caught, counted, and the next message runs.
5. **Close.** The signal `anyagent.close` sets "closing": new messages are rejected (item 1), the turn in flight finishes, **messages already queued still run**, then `run` returns.
   The workflow does not end while an update handler is still running (`allHandlersFinished`).
6. **Queries.** `anyagent.status` returns `CoreStatus`. `anyagent.rotation` returns a `RotationHint` whose `continueAsNewSuggested` is true when Temporal suggests it or `accepted >= rotateAfterAccepted`;
   `idle` is true when nothing is running or queued. Queries never change state.
7. **Determinism.** No clock, randomness or I/O in this module; ids come from the sequence of admission, not from `uuid4` unless needed, and then only from `@temporalio/workflow`.

## Steps

1. **Pure logic first.** `admission.ts` is a plain class with no Temporal import: `admit(input) → Admission`, `next()`, `finish()`, `requestClose()`, `snapshot()`. Write `admission.test.ts` (T-WP3-01 to 05) and make it pass.
2. **Wiring.** `own-core.ts` registers the update (with validator), signal and queries with `@temporalio/workflow` (`defineUpdate`, `defineSignal`, `defineQuery`, `setHandler`, `condition`,
   `allHandlersFinished`, `workflowInfo`), and runs the loop around `AdmissionQueue`. Keep it under about 150 lines; if it grows, you are building something out of scope.
3. **Temporal test helper.** `e2e/support/temporal.ts` exports `withTemporal(fn)`: starts `TestWorkflowEnvironment.createLocal()`; if the dev server cannot be started or downloaded it throws a
   `Skipped` error that the test runner reports as **skipped with the reason** (never as passed).
4. **Contract suite.** `core.contract.ts` exports `runCoreContract(makeFixtureWorkflow)` so another implementation can be tested with the same checks. The fixture workflow calls `core.run(handler)` where the handler
   runs one activity stub (`recordTurn`) and optionally fails or sleeps, controlled by the input text (`"fail"`, `"slow"`).
5. **Measure (spike 006).** In a test, send 50 messages one at a time, fetch the history (`handle.fetchHistory()`), and report **events per message by type** and total bytes. Print the table, write it to
   `spikes/006-agent-core/README.md` and the research note's "Measured" section, and set the budget assertion in T-WP3-12 to the measured figure plus 30%. The estimate to compare with is 8 to 10 events per message
   and Michel's measured 160 per turn for a streaming harness agent; say which side the result falls on. Also record the same for 3 approvals' worth of extra updates only if you have time (v1 prepares).
6. **Replay.** Fetch the history of a finished test run and replay it with `Worker.runReplayHistory` against the bundled workflow code (T-WP3-11).
7. **Spec.** Write `docs/specs/agent-core.md`: the interface, the seven behaviours, the queries, and "how to add an implementation" (run `runCoreContract`).

## Tests

- T-WP3-01 admission order and dispositions: first `opened`, the rest `queued`, turn numbers `1..n`.
- T-WP3-02 duplicate key returns `duplicate` with the original number and does not queue.
- T-WP3-03 after `requestClose`, admission is refused; what was queued is still returned by `next()`.
- T-WP3-04 `snapshot` counts (`queued`, `turns`, `accepted`) stay consistent through a random sequence of operations (property test, fixed seed).
- T-WP3-05 `rotation` hint: true at the threshold, false just below it.
- T-WP3-06 (Temporal) ten messages run in order, one at a time (the activity stub records start and end times; no overlap).
- T-WP3-07 (Temporal) the same `updateId` sent twice runs one turn; the same `key` with two update ids returns `duplicate`.
- T-WP3-08 (Temporal) after the close signal: a new message fails with `AgentClosed`, queued messages still run, the workflow completes afterwards.
- T-WP3-09 (Temporal) a failing turn does not stop the next one; `status` shows the failure count (add `failed` to the status if the test needs it, and document it).
- T-WP3-10 (Temporal) `status` and `rotation` answer during a long turn without waiting for it.
- T-WP3-11 (Temporal) replaying a recorded history succeeds (determinism).
- T-WP3-12 (Temporal) history events per message stay within the budget set from the measurement.
- T-WP3-13 `docs/specs/agent-core.md` behaviours map one to one to contract test names (a small script checks that each behaviour number is referenced by a test title).

## Checks

```bash
pnpm --filter @anyagent/workflows test            # expect: unit tests pass; Temporal tests pass or are reported skipped with the reason
pnpm --filter @anyagent/workflows exec tsc --noEmit
node scripts/check-pins.mjs
pnpm check
```

## Achievements

- [ ] The core is one module behind `AgentCore`, with the pure logic separated from the Temporal wiring.
- [ ] The contract suite is exported and passes on our core, on a real Temporal test server (or is explicitly NOT RUN, which blocks WP8).
- [ ] Events and bytes per message are measured and recorded, with the comparison to the estimate and to Michel's number.
- [ ] `docs/specs/agent-core.md` exists and matches the code.
- [ ] No import of `@temporalio/agent-harness*` anywhere.

## Stop and ask when

The measured events per message are more than 25 (the estimate is 8 to 10; a large number means something in the design is wrong); `allHandlersFinished` cannot make close deterministic with your design;
the contract cannot be written without a new behaviour that [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md) does not mention.
