# WP5: the event gateway

**Goal.** A message from an allowed person in an agent's chat reaches that agent's workflow exactly once in effect, surviving crashes of the gateway, the worker and Temporal, and
long-lived workflows are rotated before they run out of history. Includes **spike 004** (update-with-start).

**Depends on:** WP1 (the port), WP3 (`ChatInput`, update names, the rotation query). **Unblocks:** WP6.

## Scope

In: per-org supervisors, agent discovery, chat watching through the port, the authorisation and loop-guard filters, the state store, delivery by update-with-start, rotation, metrics as log lines.
Out: webhooks, object-change triggers, claims, schedules, groups (all later), a separate gateway process (v0 is one process), high availability.

## Read first

[ADR 0011](../../adr/0011-event-gateway.md), [ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md) (a supervisor per org, failure isolation), [ARCHITECTURE.md](../../ARCHITECTURE.md) sections 2 and 3,
[specs/agent-workflow.md](../../specs/agent-workflow.md), `docs/specs/agent-core.md` (written in WP3), [research/temporal-agent-harness.md](../../research/temporal-agent-harness.md) (client feature notes),
`@temporalio/client` 1.24.0 types: `startUpdateWithStart`, `executeUpdateWithStart`, `workflowIdConflictPolicy`, `waitForStage`, `updateId`.

## Files

Create: `packages/gateway/src/{state.ts,supervisor.ts,pipeline.ts,delivery.ts,rotation.ts,agents.ts,index.ts}`, `packages/gateway/test/*.test.ts`, `spikes/004-update-with-start/README.md`.
Change: `docs/SPIKES.md` (004), `docs/adr/0011-event-gateway.md` only if a spike result contradicts it (otherwise stop and ask).
Dependency added: `better-sqlite3` `13.0.3`.

## Design

- **State** (`state.ts`, SQLite under `<state.dir>/gateway.sqlite`): `cursors(space_id, source, cursor)`, `delivered(space_id, key, delivered_at)` pruned after 7 days, `meta`. Everything keyed by **space id**.
  A function `commit(space, source, cursor)` and `markDelivered(space, key)` run in one transaction.
- **Supervisor per org** (`supervisor.ts`): owns that org's backend instance and its watchers; its failure (an `Unavailable` backend, a revoked key) is logged and retried with backoff and **never** affects another org's supervisor.
  `Unauthorized` stops that org's supervisor with a clear message.
- **Agent discovery** (`agents.ts`): on start, `listAgents` for the org, then watch the `aa_agent` objects (initial state as `upsert`, then changes); keep a map `agentId → {spec, chatId}`. Start a chat watcher for each agent with a valid spec,
  stop it when the agent disappears or its spec becomes invalid. Invalid specs are logged once per change.
- **Pipeline** (`pipeline.ts`, pure given its inputs, so it is tested without Temporal): for each chat event, drop `removed`; drop messages whose author is the org's own account or that carry an agent marker (loop guard);
  drop messages whose key is already delivered; drop messages from authors not allowed by `isAllowedAuthor` (log "ignored: author not allowed", never reply); otherwise build `ChatInput` with key `chat:<chatId>:<messageId>`.
  An `upsert` of an already-delivered key is ignored (edits do not re-run a turn in v0).
- **Delivery** (`delivery.ts`): `startUpdateWithStart` the workflow `AnyBot` (id `agent:<spaceId>:<agentObjectId>`, task queue `anybot`, init `{ spaceId, agentId, nodeQueue, orgId }`) with update `anybot.chat`,
  `updateId = key`, `workflowIdConflictPolicy: USE_EXISTING`, `waitForStage: ACCEPTED`. **Only after acceptance** commit the cursor and mark the key delivered. **Pitfall (found reviewing the WP5 implementation, with a reproduction):** with `waitForStage: ACCEPTED` the start call can return before the workflow's validator has run, so a rejection (the workflow is closing, `AgentClosed`) is **not** thrown there; it only surfaces from `await handle.result()` (a `WorkflowUpdateFailedError` whose cause is an `ApplicationFailure`). Acceptance must therefore be confirmed by awaiting `handle.result()` (or by using `waitForStage: COMPLETED` for a short admit handler), and the closing error must be detected by its type, not by a message regex. Otherwise a message sent while a workflow closes is marked delivered and lost. On `AgentClosed` or "workflow already completed",
  wait briefly and retry (update-with-start then starts a new run). On a Temporal outage, do not commit and retry with backoff, so the cursor does not move past undelivered messages. A crash between acceptance and commit redelivers the
  message with the same update id, which Temporal drops within the run and the core drops by key across runs of the same history.
- **Rotation** (`rotation.ts`): every 30 s per active workflow (and after each delivery batch), query `anybot.rotation`; if `idle` and (`continueAsNewSuggested` or `accepted >= 1500`) send the close signal. The next message starts a new run.
  Never close a non-idle workflow. Log each rotation.
- **Configuration used:** `orgs[]`, `temporal`, `state.dir`; no new keys.

## Steps

1. **Spike 004 first** (needs a Temporal dev server; if none, write the test plan and mark NOT RUN, which blocks WP8): with the WP3 fixture workflow, show on a real server that update-with-start (a) starts a missing workflow and delivers,
   (b) delivers to a running one (`USE_EXISTING`), (c) drops a repeated `updateId` within a run, (d) fails with a recognisable error when the workflow is closing, and a retry starts a new run, (e) works with `waitForStage: ACCEPTED`
   and returns before the turn ends, and **record whether a validator rejection is thrown by that call or only by `handle.result()`** (it is the latter on the version tested at review: the rejection of an update sent to a closing workflow is invisible at `ACCEPTED`). Record the minimum Temporal server version that supports it. Update `spikes/004-update-with-start/README.md`.
2. **State store**, with tests.
3. **Pipeline**, with tests (pure).
4. **Delivery** against the real client in tests with the Temporal helper, plus a fake client for the failure cases.
5. **Supervisor and agent discovery** against the reference backend (WP1), including two orgs with separate memory backends.
6. **Rotation.**
7. **Observability:** one JSON log line per event with `org`, `space`, `agent`, `key`, `outcome` and, for each delivery, the event age (now minus message time); no message text in logs at the default level.

## Tests

- T-WP5-01 pipeline table: own message, agent-marked message, removed event, duplicate key, edited message (`upsert` of a delivered key), author not allowed, owner default, explicit allowed author, paused agent (still delivered; the workflow decides), valid message.
- T-WP5-02 state: commit and mark-delivered are atomic; pruning keeps recent keys; a restart reads the same cursor.
- T-WP5-03 (fake Temporal client) the cursor is **not** committed when delivery fails, and is committed after acceptance; a thrown error mid-batch leaves the cursor at the last accepted message.
- T-WP5-04 (fake) crash between acceptance and commit: after restart the message is delivered again with the same update id and the second acceptance is treated as success.
- T-WP5-05 (Temporal) end to end with the fixture workflow: ten messages in a chat arrive in order, once each.
- T-WP5-06 (Temporal) `AgentClosed`: deliver while closing, observe the retry start a new run, and no message lost or doubled.
- T-WP5-07 (Temporal) rotation closes an idle workflow at the threshold (lowered in the test), never a busy one, and the next message works.
- T-WP5-08 two orgs: org A's backend returns `Unavailable` for a minute; org B's messages are still delivered; A catches up when it returns.
- T-WP5-09 `Unauthorized` stops only that org's supervisor with a message naming the org.
- T-WP5-10 agent discovery: a new agent starts a watcher; an agent whose spec becomes invalid stops; a deleted agent stops.
- T-WP5-11 resume: stop the gateway, post messages, start it: exactly the missed messages are delivered, none before the cursor.

## Checks

```bash
pnpm --filter @anybot/gateway test      # expect: pass; Temporal tests pass or are reported skipped with the reason
pnpm check
```

## Achievements

- [x] No message is lost or run twice across a gateway crash, a Temporal outage and a workflow rotation (T-WP5-03 to 07, 11).
- [x] A failing org never blocks another (T-WP5-08, 09).
- [x] Unauthorised authors and the agent's own messages never start a turn.
- [ ] Spike 004's five questions are answered on a real server and the minimum server version is recorded. (SDK test server: yes; self-hosted/Cloud minimum version: NOT RUN — blocks WP8)

## Stop and ask when

Update-with-start does not behave as [ADR 0011](../../adr/0011-event-gateway.md) assumes (for example a repeated `updateId` is not dropped); the backend cannot say who wrote a message; the chat stream can lose messages (a gap that the
cursor cannot detect).
