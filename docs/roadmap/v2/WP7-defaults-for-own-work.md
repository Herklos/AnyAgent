# v2 WP7: the defaults for agents' own work

**Goal.** An agent can do the two things it needs to run its own work, create tasks and manage its own schedules, and nothing else about the org; the limit is enforced where the write happens, on the node, and cannot be bypassed from the harness. This starts **spike 013**; v3 completes the table.

**Depends on:** WP4, WP5. **Unblocks:** WP8, and v3's permission work.

## Scope

In: `aa_permissions` and `aa_permissions_ask` on `aa_agent` (schema `0.3.1`), the effective-permission rule and the `none` value, the pure permission table for `task.create` and `schedule.self` (every other id refused with "not available yet"), the schedule tools, limits on schedules, the person-only field guard in the write path, `doctor`.
Out: `schedule.reports`, `trigger.self`, `agent.*`, `group.edit` (v3), enforcement at the gateway (v3, needs the modifier), `aa_permissions_ask` creating approvals (v3).

## Read first

[ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (all of it; this package is decisions 1 and 3 for two permissions and decision 2 in full), [specs/schema.md](../../specs/schema.md) (`aa_agent`, `aa_schedule`), v1 WP4 (schedules), WP4 of this release (tools and the tool API), [SPIKES.md](../../SPIKES.md) (013).

## Files

Create: `packages/core/src/permissions.ts`, `packages/node/src/egress.ts`, `packages/mcp/src/schedule-tools.ts`, tests, `docs/specs/permissions.md`.
Change: `packages/core/src/{schema.ts,schema-versions.ts}` (a `0.3.1` step), `packages/node/src/tool-api.ts`, `packages/core/src/agent-spec.ts`, `apps/cli` (doctor), `docs/specs/{schema.md,org-tools.md}`.

## Behaviour

1. **Fields:** `aa_permissions` and `aa_permissions_ask` (multi_select of permission ids; person-only). Migration step `0.3.0 → 0.3.1` adds them.
2. **Effective permissions:** if `aa_permissions` is empty the defaults apply (`task.create`, `schedule.self`); otherwise exactly the listed ids; the special value `none` means no permission at all (an empty multi-select cannot be told from "unset"). `aa_permissions_ask` is parsed and stored; in v2 any id in it is treated as **refused** (it will create approvals in v3) and `doctor` says so.
   Unknown ids are ignored with a `doctor` warning.
3. **The table** `permissions.can({ agent, action, target })` (pure): `task.create` allows creating an `aa_task` in a group the agent is a member of; `schedule.self` allows creating, editing, enabling, disabling and deleting an `aa_schedule` whose `aa_owner` is the agent itself. Every other action returns `{ ok: false, reason: "not available in this release" }` for the v3 ids and `"not permitted"` otherwise.
4. **Enforcement point:** the node's write path (`tool-api` and `egress.ts`). Every tool that writes calls `can` first. The harness never has the read-write key (WP4), so the tool is the only door.
5. **Person-only fields:** `aa_permissions`, `aa_permissions_ask`, `aa_approval_mode`, `aa_account`, `aa_approvers`, `aa_allowed_authors` (settings and group), `aa_settings` in general, and any approval decision. `egress.ts` wraps the backend used for agent-initiated writes and **refuses any object update or create whose patch names a person-only key or whose target is a person-only type**, as defence in depth beyond the tools simply not offering such operations.
6. **Schedule tools:** `schedule_create { cron, timezone, prompt, enabled? }` (owner is always the calling agent; `aa_owner` cannot be set), `schedule_update`, `schedule_enable`, `schedule_disable`, `schedule_delete`, `schedule_list`. **Limits** (to stop an agent starving the machine): at most `tuning.maxSchedulesPerAgent` (default 10); the cron must not fire more often than every `tuning.minScheduleIntervalMinutes` (default 15, checked by computing the next 20 fire times); the prompt (the body) is at most 4,000 characters.
   Schedules an agent creates are visible objects like any other; the reconciler (v1) picks them up.
7. **Refusal behaviour:** the tool returns a tool error with the reason and the permission id; the node posts at most one notice per agent per hour for the same permission (`I am not allowed to <action>: it needs the permission <id>. Ask the owner.`), through the notice catalogue.
8. **`doctor`:** each agent's effective permissions; agents with `none`; `aa_permissions_ask` entries (refused until v3); unknown ids.

## Steps

1. `permissions.ts` and its table test (spike 013 starts here: one row per permission id × action × target kind, with the v3 ids returning "not available").
2. Schema step `0.3.1` and the agent spec parsing; the `none` rule.
3. `egress.ts` with the person-only key list (as data, from `schema.md`'s writer columns, with a test that the list matches the document).
4. Schedule tools and limits; refusal notices.
5. Docs.

## Tests

- T-V2-WP7-01 effective permissions: unset gives defaults, a list replaces them, `none` gives nothing, unknown ids are ignored with a warning, an `aa_permissions_ask` entry is refused.
- T-V2-WP7-02 the table: `task.create` in a member group allowed, in a group the agent is not in refused; `schedule.self` on its own schedule allowed, on another agent's refused; every v3 permission refused with the right reason.
- T-V2-WP7-03 every writing tool calls `can` before any backend call (spy backend: with `none`, no write method is ever called).
- T-V2-WP7-04 person-only guard: an agent-initiated update naming each person-only key is refused; an update naming only ordinary keys passes; the list equals the writer columns in `schema.md`.
- T-V2-WP7-05 schedule limits: the 11th schedule refused; a cron every minute refused; a 15-minute cron accepted; an oversized prompt refused; `aa_owner` cannot be set to another agent.
- T-V2-WP7-06 the harness environment and the tool socket give no way to write without `can`: a probe harness calling the bridge with every tool under `none` gets refusals only.
- T-V2-WP7-07 notices: one per agent per hour per permission, with the exact text.
- T-V2-WP7-08 the `0.3.0 → 0.3.1` migration is idempotent and keeps existing agents (their permissions are unset, so defaults apply).
- T-V2-WP7-09 (Temporal, fake harness) an agent creates a task and a schedule within its defaults and the schedule fires later; an agent set to `none` can do neither and the person is told once.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/node test && pnpm --filter @anybot/mcp test
grep -rn "readWriteKey\|WRITE_KEY" packages/harness packages/mcp   # expect: no matches (keys never reach harness-side code)
pnpm check
```

## Achievements

- [ ] An agent can create tasks and manage its own schedules by default, and can do nothing else to the org.
- [ ] `none` really means nothing, and every refusal is explained to the agent and, once, to the people.
- [ ] Person-only fields cannot be written by any agent path, tested key by key.
- [ ] Spike 013's table exists with v2's rows; v3 extends it.

## Stop and ask when

A person-only key turns out to be needed by a legitimate agent flow; the backend lets a harness reach the write API by another route (a shared socket or a leaked key); the default limits are wrong for how the owner uses schedules.
