# v1 WP4: schedules

**Goal.** A person writes an `aa_schedule` object (a cron, a time zone, a prompt) and the owner agent wakes on time, runs the prompt and posts the result in its chat, with `aa_next_run` and `aa_last_run` kept up to date, surviving restarts and downtime.

**Depends on:** v0. **Unblocks:** WP8.

## Scope

In: the `aa_schedule` type, the gateway reconciler, Temporal Schedules, the `ScheduleKick` workflow, the `scheduleFired` handler, the projection workflow and activity, validation, `doctor`.
Out: agents creating schedules (v2 and v3 permissions), delivery to groups (v2 adds `aa_deliver_to`; in v1 the result is posted in the owner's own chat), triggers.

## Read first

[specs/agent-workflow.md](../../specs/agent-workflow.md) ("Schedules"), [ADR 0011](../../adr/0011-event-gateway.md) (decision 3), [specs/schema.md](../../specs/schema.md) (`aa_schedule`), [ADR 0003](../../adr/0003-one-shared-temporal-one-workflow-per-agent.md), Temporal TypeScript Schedules documentation, and from v0: `packages/gateway/src/{supervisor.ts,delivery.ts}`, `packages/workflows/src/`.

## Files

Create: `packages/core/src/schedule.ts` (parse and validate), `packages/gateway/src/schedules.ts` (reconciler), `packages/workflows/src/{schedule-kick.ts,schedule-projection.ts}`, `packages/node/src/activities/{resolve-schedule,write-schedule-projection}.ts`, tests.
Change: `packages/core/src/schema.ts` (`aa_schedule`), `packages/workflows/src/{contracts.ts,anyagent-workflow.ts}` (`scheduleFired`), `packages/workflows/src/workflows.ts` (export the new workflows), `docs/specs/{schema.md,agent-workflow.md}`, `apps/cli` doctor.

## Schema (additive, schema version `0.2.0`)

`aa_schedule` with `aa_owner` (objects → `aa_agent`), `aa_cron` (5 fields), `aa_timezone` (IANA), `aa_enabled` (checkbox), `aa_next_run` and `aa_last_run` (date, node-written). Body: the prompt. In v1 there is no `aa_deliver_to`.

## Behaviour

1. **Reconciler** (gateway, per org): list `aa_schedule` objects and watch changes. Desired Temporal Schedule for each, id `schedule:<spaceId>:<scheduleObjectId>`: spec = the cron and time zone (`timezoneName`); **paused** unless `aa_enabled` is true and the owner agent exists and is `live`;
   action = start `ScheduleKick` on task queue `anyagent` with `{ orgId, spaceId, scheduleId, agentId }`; overlap policy `SKIP`; catch-up window 10 minutes. Diff against `list()` of Temporal Schedules with the `schedule:<spaceId>:` prefix: create what is missing, update what differs
   (pause, unpause, spec), **delete** what no longer has an object. Idempotent and safe to run repeatedly. An invalid cron or zone is not created and is reported (log and `doctor`), and does not break the others.
2. **`ScheduleKick`** (tiny workflow): sends `scheduleFired` `{ key: "<scheduleId>:<scheduled time>", scheduleId }` to the owner's workflow with update-with-start, waits for acceptance, then ends. The key is stable per occurrence, so a retried kick does not duplicate the run.
3. **`scheduleFired` handler** in `AnyAgent`: admitted like a chat message (through the core's queue, so it runs after earlier turns, in order); the turn's prompt is the schedule's body, read fresh by activity `resolveSchedule` (it also returns the agent's own chat id as the delivery chat in v1);
   author is treated as the owner for `read_only`/`ask`/`full` purposes (the schedule is the person's standing instruction); the reply is posted in the agent's own chat with a first line `🕘 <schedule name>`. Paused agent: no turn, `aa_last_run` not updated, one log line.
4. **Projection:** after each fire and on a change, workflow `ScheduleProjection` runs activity `writeScheduleProjection` on the node queue to set `aa_next_run` (from the Temporal Schedule's next action time) and `aa_last_run`. The gateway never writes to Anytype.
5. **Deleting or archiving** a schedule object deletes its Temporal Schedule; disabling pauses it; changing the cron updates it without losing the "last run".
6. **`doctor`:** each schedule parses (cron, zone), its owner exists and is live, and the Temporal Schedule exists and matches.

## Steps

1. Pure parsing and validation in `core/schedule.ts`, with table tests (valid and invalid crons, zones, DST edge).
2. The desired-state function `desiredSchedule(object, agent)`; the diff function; both pure.
3. Reconciler against a fake Temporal schedule client, then against the real client in Temporal's test environment.
4. `ScheduleKick`, the handler, the projection.
5. End to end with time skipping and the fake harness.
6. Docs and `doctor`.

## Tests

- T-V1-WP4-01 cron and zone parsing: valid, five-field only, bad ranges, unknown zone, `Europe/Paris` and `America/New_York` across DST changes (the next action times are right).
- T-V1-WP4-02 `desiredSchedule`: enabled and live owner is running; disabled is paused; owner paused or missing is paused; invalid is rejected with the reason.
- T-V1-WP4-03 diff: create, pause, unpause, spec change, delete on object removal, no-op when equal; running it twice changes nothing.
- T-V1-WP4-04 (Temporal, time skipping) a schedule fires on time, the owner's workflow runs a turn with the schedule's body as the prompt, and the reply appears in the agent's chat with the `🕘` line.
- T-V1-WP4-05 the same occurrence kicked twice produces one turn (same key).
- T-V1-WP4-06 (Temporal) downtime shorter than 10 minutes: one catch-up run; longer: none; the next normal fire works.
- T-V1-WP4-07 two schedules for one agent at the same time: two turns, in order, neither lost.
- T-V1-WP4-08 a paused agent: no turn and no error.
- T-V1-WP4-09 projection: `aa_next_run` and `aa_last_run` are written by the node activity, and the gateway never calls the backend's write methods (assert with a spy backend).
- T-V1-WP4-10 an invalid schedule next to a valid one: the valid one still runs; `doctor` lists the invalid one.
- T-V1-WP4-11 schema: `aa_schedule` is created idempotently; the v0 to `0.2.0` upgrade keeps v0 objects.
- T-V1-WP4-12 (live, opt-in) a one-minute schedule on a real throwaway space posts, twice.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/workflows test && pnpm --filter @anyagent/node test
pnpm check
```

## Achievements

- [ ] A weekday schedule posts at the right local time, including across a DST change.
- [ ] The reconciler is idempotent and converges: create, change, pause, delete.
- [ ] The projection fields are written by a node and never by the gateway.
- [ ] A restart or a short outage loses no occurrence that is inside the catch-up window and duplicates none.

## Stop and ask when

The Temporal server in use does not support the Schedules features needed (note the minimum version); a cron semantic differs from what the owner expects (for example day-of-month and day-of-week both set); `aa_next_run` cannot be written because the date format is not accepted by the backend.
