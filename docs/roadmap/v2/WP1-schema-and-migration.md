# v2 WP1: schema delta and `anybot migrate`

**Goal.** The `aa_*` schema grows to what a team needs (groups, nodes, accounts, prompts, tasks and the new agent fields), a space created by v0 or v1 upgrades in place without losing anything, and the program refuses to run against a schema it does not understand.

**Depends on:** v1 released. **Unblocks:** every other v2 package.

## Scope

In: the new types and fields as data, version `0.3.0`, a real `anybot migrate` (plan, apply, verify), the queries bootstrap creates, the compatibility rule between program and space.
Out: moving existing data between types, deleting or renaming anything, the permission fields' enforcement (WP7 and v3), memory and skills types.

## Read first

[specs/schema.md](../../specs/schema.md) (all of it), [ADR 0009](../../adr/0009-new-minimal-versioned-schema.md), [ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md), [ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (person-only fields),
and from v1: `packages/core/src/schema.ts`, `packages/admin/src/init.ts`, `packages/backend` (`ensureSchema`).

## Files

Create: `packages/admin/src/migrate.ts`, `packages/core/src/schema-versions.ts`, tests, `docs/specs/schema-migrations.md`.
Change: `packages/core/src/schema.ts`, `packages/admin/src/init.ts` (calls migrate), `apps/cli/src/main.ts` (`migrate` command), `docs/specs/schema.md`.

## The delta (version `0.3.0`), all additive

- **New types:** `aa_node` (`aa_handle`, `aa_harnesses`, `aa_last_seen`, `aa_accounts`, `aa_lifecycle`), `aa_account` (`aa_handle`, `aa_participant_id`, `aa_tag_always`, `aa_lifecycle`), `aa_prompt` (`aa_prompt_kind` = `system`, `rules`, `library`, `approval_criteria`; `aa_version`), `aa_group` (`aa_chat_id`, `aa_members`, `aa_lead`, `aa_routing`, `aa_claims`, `aa_allowed_authors`, `aa_max_hops`, `aa_purpose`),
  `aa_task` (`aa_status`, `aa_group`, `aa_lead`, `aa_assignee`, `aa_reviewer`, `aa_requested_by`, `aa_origin_message`, `aa_criterion`, `aa_result`, `aa_due`, `aa_op_key`). Field lists exactly as in `schema.md`; build from that file, and change the file if a live run shows a field cannot be expressed.
- **New fields on `aa_agent`:** `aa_node` (objects → `aa_node`), `aa_account` (objects → `aa_account`), `aa_prompt` (objects → `aa_prompt`), `aa_reports_to` (objects → `aa_agent`), `aa_session_scope` (`agent` | `task`), `aa_status` (node-written projection), and `aa_lifecycle` gains `draft` and `archived`.
  v0's `aa_chat` stays: it is the agent's own direct chat for ever.
- **New fields on `aa_settings`:** `aa_rules` (objects → `aa_prompt`), `aa_temporal_namespace` (informational). `aa_approval_mode` stays as in v1.
- **Queries (saved views) created by migrate:** `Agents`, `Tasks – Board` (kanban on `aa_status`), `Nodes`; `Approvals – Pending` and `Schedules – Calendar` from v1 are kept. If the backend cannot create a saved query, `migrate` says so and continues.
- **Not added yet:** `aa_trigger` (v3), `aa_permissions` and `aa_permissions_ask` on `aa_agent` (WP7 adds them, because the defaults need them), `aa_decision_model`, `aa_approval_criteria`, `aa_tools`, `aa_effort`.

## `anybot migrate`

1. **Version rule:** the program supports schema versions up to its own. A space with a **newer** version than the program makes every command except `doctor` refuse with `The space uses schema <v>; this anybot supports up to <v>. Upgrade anybot.`
2. **Plan** (`migrate --plan`, the default for `init --check`): compare the space's types and fields with the target; list exactly what would be created; change nothing.
3. **Apply** (`migrate`): `ensureSchema` for the missing types, fields and options; create the queries; set `aa_schema_version` to the target in one final write (so a failed run leaves the old version and can be rerun). Idempotent: a second run reports nothing to do.
4. **Verify:** read every type back and assert the expected fields and options exist; report mismatches (a field with the wrong format is an error, never auto-fixed).
5. **Ordering:** migrate steps are a list of versioned steps (`0.1.0` to `0.2.0`, `0.2.0` to `0.3.0`), each pure data plus a small function, so later releases add steps and never edit old ones.
6. **Safety:** `migrate` never deletes or renames; it refuses to run if another anybot holds the space (the deployment memo check from v1 WP7) unless `--force`.

## Steps

1. Express the delta as data and check it against `schema.md` with a test that parses the markdown tables and compares field names (so the document and the code cannot drift).
2. The migration engine (plan, apply, verify) against the reference backend.
3. `init` and the CLI command; the version rule in every command.
4. Run on a v0-created and a v1-created space (fixtures recorded from earlier releases, or built with the old `init`), then live on a throwaway space.
5. Write `docs/specs/schema-migrations.md` (how to add a step).

## Tests

- T-V2-WP1-01 the schema data matches the tables in `schema.md` field by field (names, formats, options).
- T-V2-WP1-02 plan lists exactly the missing pieces for a `0.1.0` space, a `0.2.0` space and a `0.3.0` space (empty).
- T-V2-WP1-03 apply twice: the second run changes nothing; the version is written last (kill the run before the final write and rerun: it completes).
- T-V2-WP1-04 existing v0 and v1 objects are untouched after migrate (compare before and after).
- T-V2-WP1-05 a newer space version makes commands refuse with the exact message; `doctor` still runs.
- T-V2-WP1-06 verify catches a field with the wrong format and an option missing.
- T-V2-WP1-07 migrate refuses while another deployment holds the space, and `--force` proceeds.
- T-V2-WP1-08 (live, opt-in) the whole upgrade on a throwaway space created by the v1 release.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/admin test
ANYBOT_LIVE_ANYTYPE=1 pnpm --filter @anybot/admin test    # or NOT RUN with reason
pnpm check
```

## Achievements

- [ ] A v0 or v1 space upgrades to `0.3.0` in place, twice, losing nothing.
- [ ] The schema code and `schema.md` cannot drift (a test fails if they do).
- [ ] A newer space is refused cleanly.
- [ ] How to add the next migration step is written.

## Stop and ask when

The backend cannot create a relation or a select option after creation; a v0 or v1 space contains an `aa_*` type with a different shape than the program created; the saved-query API behaves differently from what v1 found.
