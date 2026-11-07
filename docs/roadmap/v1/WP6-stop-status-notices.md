# v1 WP6: `/stop`, `anybot status`, notices and usage

**Goal.** The owner can stop a running turn by typing `/stop` in the agent's chat, can see with one command what every agent is doing, and every failure or stop produces one clear, non-spammy notice that says what happened and what it cost.

**Depends on:** v0 (WP2 for stopping a turn that waits on an approval). **Unblocks:** WP8.

## Scope

In: the `/stop` command in the gateway, cancellation in the core and the node, `anybot status`, the notice catalogue and its rate limit, the per-turn usage record.
Out: other chat commands, a "pause" command (the `aa_lifecycle` field is the switch), mid-turn steering, editing a "working…" message (Q13).

## Read first

`docs/specs/agent-core.md` (written in v0 WP3) and [specs/agent-workflow.md](../../specs/agent-workflow.md) (notices table, turn), [ADR 0011](../../adr/0011-event-gateway.md), WP2's gate design, the v0 packages `packages/{gateway,workflows,node}` and `apps/cli`.

## Files

Create: `packages/gateway/src/commands.ts`, `packages/workflows/src/core/stop.ts`, `packages/node/src/turn-log.ts`, `apps/cli/src/status.ts`, `packages/core/src/notices.ts` (the catalogue), tests.
Change: `packages/gateway/src/pipeline.ts`, `packages/workflows/src/core/own-core.ts` (cancel scope, new update), `packages/workflows/src/{contracts.ts,anybot-workflow.ts}`, `packages/node/src/activities/{run-turn,deliver}.ts`, `docs/specs/agent-core.md`, `docs/specs/agent-workflow.md`.

## Behaviour

1. **Command parsing (gateway, pure):** a message from an **allowed author** whose trimmed text equals `/stop` (case-insensitive, optionally followed by a handle that must match the agent) is a command, not input. Anything else that starts with `/` is a normal message. Commands from disallowed authors are ignored like any message.
2. **Stop semantics:** `/stop` ends the turn in flight, **drops every queued message**, denies every pending approval with reason `stopped`, and posts one notice: `Stopped.` or `Stopped. <n> queued messages dropped.` If nothing is running, the reply is `Nothing is running.` The `/stop` message itself is never a turn.
3. **Core:** a new update `anybot.stop` `{ key, by }` (deduped by key like chat). The core runs each turn inside a cancellable scope; the update cancels the scope, clears the queue, and tells the approval book to deny everything. Add the behaviours to `docs/specs/agent-core.md` and to `runCoreContract`.
4. **Node:** the cancelled `runTurn` activity (cancellation type "wait for cancellation completed") sees the cancellation through its heartbeat, calls `session.cancel()`, then `close()`, then `kill()` after a 10 s grace, and returns; the node store records outcome `stopped`.
   The harness's partial output is discarded, never posted.
5. **Gateway, no workflow running:** `/stop` does not start a workflow; the gateway asks the node to post `Nothing is running.`
6. **Turn log (node store):** table `turns(workflow_id, key, started_at, ended_at, outcome, harness, model, input_tokens, output_tokens)` with outcome `replied`, `failed`, `interrupted`, `stopped`, `refused`; a retention of 30 days. Usage comes from the harness when it reports it.
7. **`anybot status [--org id] [--json]`:** for each agent of each org: handle, harness and mode, lifecycle, state (`idle`, `running` with how long, `waiting approval` with the count and the oldest request's age, `offline` if no workflow and not paused), queued count, last outcome and time from the local turn log, tokens in the last 24 hours. Temporal fields come from the `anybot.status` query and `describe`
   and work from any machine; the turn-log fields are read from this machine's store and are shown as `n/a (other node)` when the agent runs elsewhere. Exit code 0 always, unless the backend or Temporal is unreachable (then 1 with the reason).
8. **Notice catalogue** (`notices.ts`): one function per notice with the exact text, in one place: cannot run (config), interrupted, harness unavailable, harness error, empty reply, stopped, nothing running, mode unsupported, model cannot call tools, node offline (v2 reuses it), approval service unavailable. Each notice ends with a short usage tail when known: `(3m 12s, 14.2k tokens)`.
9. **Rate limit:** at most one notice per agent per minute for the same reason; the next ones are logged and counted (`suppressed_notices` in the turn log), and the first notice after the minute says `(+n similar notices suppressed)`. A notice is never posted for a notice (the loop guard already drops the agent's own messages).

## Steps

1. Command parser and tests (pure).
2. Core stop with contract tests; node cancellation path with the fake harness.
3. Turn log and the status command.
4. Notice catalogue, replace the ad-hoc texts from v0, rate limiter with tests.
5. Docs.

## Tests

- T-V1-WP6-01 parser: `/stop`, `/STOP`, ` /stop `, `/stop chief` for the right and the wrong handle, `/stopwatch` (a normal message), `/stop now` (a normal message), a disallowed author.
- T-V1-WP6-02 (Temporal) stop during a turn: the harness is cancelled, no reply is posted, queued messages are dropped, one notice with the count, the next message works.
- T-V1-WP6-03 (Temporal) stop with a pending approval: the approval is denied with `stopped`, the turn ends, the approval object (WP3) shows denied.
- T-V1-WP6-04 (Temporal) stop with nothing running replies `Nothing is running.` and starts no workflow.
- T-V1-WP6-05 the same `/stop` delivered twice (redelivery) stops once.
- T-V1-WP6-06 node: cancellation escalates `cancel`, `close`, `kill` in order, leaves no orphan process, and records `stopped`.
- T-V1-WP6-07 turn log: each outcome is recorded; usage is stored; rows older than 30 days are pruned.
- T-V1-WP6-08 status: a table over states (idle, running, waiting approval, offline, paused), `--json` shape is stable, other-node fields show `n/a`, exit codes.
- T-V1-WP6-09 notices: each text is exactly as catalogued; the usage tail appears only when known; the rate limit suppresses and reports the count once.
- T-V1-WP6-10 `runCoreContract` (extended) passes.

## Checks

```bash
pnpm --filter @anybot/gateway test && pnpm --filter @anybot/workflows test && pnpm --filter @anybot/node test && pnpm --filter @anybot/core test && pnpm --filter anybot test
pnpm check
```

## Achievements

- [ ] `/stop` ends a running turn within seconds on every shipped harness (fake and live), with one notice and no stray output.
- [ ] `anybot status` answers "what is each agent doing" in one command.
- [ ] Every notice text lives in the catalogue, is tested, and cannot spam.

## Stop and ask when

A harness cannot be cancelled without losing its session (then say so in the notice and in the guide); the owner expects `/stop` to keep the queue (the semantics above drop it).
