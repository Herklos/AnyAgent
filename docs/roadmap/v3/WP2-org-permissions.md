# v3 WP2: org permissions in full

**Goal.** Agents can change the org exactly as far as people allowed, no further, and the limit holds even if the harness is hostile: every permission of [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) is enforced at the node's write path, the person-only fields are unreachable, actions on an agent's `ask` list wait for an approval,
and where Anytype shows who edited an object a third layer catches changes that bypassed the tools. This package turns every `pending` row of spike 013's table green.

**Depends on:** WP1. **Unblocks:** WP3, WP4, WP6.

## Scope

In: the nine permissions, the full pure table, the org tools (`agent_*`, `group_*`, `trigger_*`, `schedule_*` for reports, `prompt_update`), draft agents, `aa_permissions_ask` through the approval gate, rate limits, org-change notices, the gateway layer (conditional), `doctor`.
Out: new permission ids, role objects (named bundles, [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) says not in v0 to v3), claims (WP5), the decision model approving org changes (a hard floor, WP3).

## Read first

[ADR 0013](../../adr/0013-agent-permissions-over-the-org.md), `docs/specs/permissions.md` (started in v2 WP7), WP1's `permissions.table.yaml`, [specs/schema.md](../../specs/schema.md) (the writer columns), v2 WP7 (`permissions.ts`, `egress.ts`, the tool API), v2 WP4 (the bridge and tools), v1 WP2 and WP3 (the gate and approvals), [ARCHITECTURE.md](../../ARCHITECTURE.md) section 7, and the v2 spike 005 outcome (is the modifier visible?).

## Files

Create: `packages/mcp/src/org-tools.ts`, `packages/node/src/{org-write.ts,rate-limit.ts}`, `packages/gateway/src/org-guard.ts`, tests, finish `docs/specs/permissions.md`.
Change: `packages/core/src/{permissions.ts,schema.ts,schema-versions.ts}` (WP2 adds `aa_effort` to the shared `0.4.0` step; the permission fields came with v2), `packages/node/src/{tool-api.ts,egress.ts}`, `packages/workflows/src/core/approval.ts` (kind `org-change`), `packages/core/src/notices.ts`, `apps/cli` (`doctor`), `docs/specs/{agent-workflow.md,org-tools.md}`.

## The permissions (exactly [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md)'s table; the table test is the contract)

`task.create`, `schedule.self` (v2), plus: **`schedule.reports`**: the same actions for schedules owned by agents that report to it, transitively. **`trigger.self`**: create or edit `aa_trigger` it owns; a new webhook trigger stays inert until a person configures its secret. **`agent.create`**: create an `aa_agent` forced to `draft` with `aa_reports_to` set to itself; person-only fields stay unset.
**`agent.activate`**: set `aa_lifecycle` of an agent it created or that reports to it (transitively) to `live`, `paused` or `archived`; a `live` agent still needs a person-set `aa_account` and `aa_node` or `resolveConfig` refuses it. **`agent.edit.self`**: its own `aa_prompt` links, `aa_model`, `aa_effort`, `aa_session_scope`, and the bodies of prompts linked only by it (never shared prompts or rules).
**`agent.edit.reports`**: those fields plus `aa_node` and `aa_harness` and `aa_endpoint` of agents that report to it (transitively); never person-only fields. **`group.edit`**: create groups it leads; edit `aa_members`, `aa_routing`, `aa_purpose` of groups it leads. Cycles in `aa_reports_to` never grant anything beyond the agent's own reach.
**Never grantable:** `aa_permissions`, `aa_permissions_ask`, `aa_approval_mode`, `aa_account`, `aa_approvers`, `aa_allowed_authors`, `aa_claims`, `aa_max_hops`, `aa_secret_ref`, `aa_enabled` on triggers, `aa_settings`, and every approval decision.

## Behaviour

1. **The table** `permissions.can({ agent, action, target, context })` returns `allow`, `ask` or `deny(reason)`; pure; identical to the YAML rows. An action listed in `aa_permissions_ask` returns `ask` even if `aa_permissions` also lists it.
2. **Enforcement at the node write path:** every org tool calls `can` before any write; the egress wrapper refuses person-only keys and person-only types regardless of the tool (v2); the read-write key never reaches a harness (v2). There is no other way for an agent process to write.
3. **`ask` actions:** the tool call is gated like a tool permission: the workflow's `permission` update with kind `org-change` and a summary (`create group "ops" with members a, b`); the approval object and chat message are created (v1 WP3); on ✅ the tool proceeds and writes; on ❌ or expiry it returns the refusal. **A decision model never approves an org change** (hard floor, WP3). With `read_only` mode no org write is possible at all.
4. **Draft and lifecycle:** a created agent is `draft` and has no workflow; it cannot run until a person sets `aa_account`, `aa_node` and `aa_lifecycle` live (or an agent with `agent.activate` sets lifecycle, but the account and node remain person-only). `doctor` lists drafts and what each lacks.
5. **Rate limits** (per agent, `tuning.orgWritesPerHour` default 20, `tuning.agentsCreatedPerDay` default 5): beyond them the tool refuses with the reason; the people get one notice.
6. **Visibility:** each org change by an agent posts one notice in the relevant chat (`🛠 @x created agent @y (draft)`, `🛠 @x changed the members of group ops`), carries `aa_op_key`, and appears in Anytype's own history; the next turn of every affected agent reads the new configuration (live configuration, v2 WP3).
7. **Gateway layer** (only if the modifier of an object is visible, v2's spike 005 answer): an `aa_*` object whose last modifier is an **agent account** and whose change touches a person-only field, or concerns a type the agent has no permission for at all (for example an `aa_group` edit by an agent with no `group.edit`), is **not routed and not reconciled**: the gateway keeps the last authorised version in its cache and asks a node to post
   `Ignored a change to <object> by @x: not permitted.` If the modifier is not visible this layer is absent and `doctor` says "only the node layer protects the org".
8. **Layer one, documented:** an agent that must never write runs on an account whose key is read-only; the guide shows how and `doctor` can verify the scope where the backend reports it.
9. **Tools:** `agent_create`, `agent_update`, `agent_set_lifecycle`, `group_create`, `group_update`, `trigger_create`, `trigger_update`, `schedule_*` (including for reports), `prompt_update`; each returns the permission id in a refusal. The OpenAI harness gets the same tools natively with the same `can`.

## Steps

1. Implement `can` until the table passes (WP1's `pending` count goes to zero); fix the YAML only with a written reason in the commit message if a row proves wrong.
2. The org tools and the node write path; the person-only guard.
3. `ask` through the gate with kind `org-change`; the floor hook (no model approval).
4. Draft agents, `resolveConfig` refusal for a live agent without account or node.
5. Rate limits and notices.
6. The gateway layer behind the visibility capability.
7. `docs/specs/permissions.md` finished (the table in prose and a pointer to the YAML), `doctor`.

## Tests

- T-V3-WP2-01 the whole table: zero `pending` rows, every row green.
- T-V3-WP2-02 every org tool, under every permission set in a small matrix (full, none, only `ask`, only reports), calls `can` before any write (spy backend: no write when denied).
- T-V3-WP2-03 person-only guard, key by key, through every tool and through a hand-crafted tool-API call: always refused.
- T-V3-WP2-04 `ask`: the approval is created, a ✅ lets the write happen once, ❌ and expiry refuse, a decision model verdict (a fake always-approving evaluator) changes nothing for kind `org-change`.
- T-V3-WP2-05 `agent.create` yields `draft`, `reports to self`, no account or node; the draft has no workflow; a person completing the fields makes it runnable; an agent with `agent.activate` alone cannot make an account-less agent run.
- T-V3-WP2-06 transitive reports and a cycle (a→b→a): rights stay within the real subtree, no infinite loop.
- T-V3-WP2-07 rate limits and the single notice.
- T-V3-WP2-08 notices and op keys: each change is announced once with its link and cannot wake its own author.
- T-V3-WP2-09 gateway layer (a backend double that exposes the modifier): an agent-account edit of a person-only field or of a forbidden type is ignored, the cache keeps the authorised version, one notice is posted; with the modifier hidden the layer is off and `doctor` says so.
- T-V3-WP2-10 hostile harness probe (a fake harness that tries every tool, every key and every socket): nothing outside the table ever writes.
- T-V3-WP2-11 (live, opt-in) a real harness agent with `agent.create` makes a draft agent; a person completes and activates it; it answers.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/mcp test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/workflows test
pnpm check
```

## Achievements

- [ ] All 150+ table rows pass; no `pending` rows remain.
- [ ] No test path writes a person-only field or exceeds a permission; every org change is announced and linked.
- [ ] `ask` actions wait for a person and are never approved by a model.
- [ ] The third layer is present when the modifier is visible, and its absence is stated otherwise.

## Stop and ask when

A legitimate flow needs a person-only field; the table and the ADR disagree (the ADR wins, but ask); an agent can cause a write through a path the table does not cover (a security finding: stop and report).
