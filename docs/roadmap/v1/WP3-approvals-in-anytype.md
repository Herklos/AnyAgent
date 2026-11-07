# v1 WP3: approvals in Anytype

**Goal.** A pending approval shows up where people already are: an `aa_approval` object and a chat message. A ✅ or ❌ from a verified approver decides it; nobody else can. Expiry, restarts and double clicks are all safe. This package includes **spike 011** for approver identity.

**Depends on:** WP2. **Unblocks:** WP8.

## Scope

In: the `aa_approval` type and `aa_settings.aa_approvers`, the activities `createApproval` and `recordDecision`, the gateway's reaction watcher and approver check, the decision delivery, the chat notices, the `Approvals – Pending` query, `init` and `doctor` changes, a `migrate` step to schema `0.2.0`.
Out: approval by editing the object's status (only if the backend shows who edited, see step 6), several approvers required, `remember`, the decision model.

## Read first

[ADR 0008](../../adr/0008-approvals-objects-and-reactions.md), [ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) (decisions 3 and 5), [specs/schema.md](../../specs/schema.md) (`aa_approval`, `aa_settings`),
[research/anytype-api.md](../../research/anytype-api.md) (reactions, `?reactions=full`), [ADR 0011](../../adr/0011-event-gateway.md), and WP2's design. From v0: `packages/gateway/src/{pipeline.ts,delivery.ts}`, `packages/admin/src/init.ts`, the WP2 spike results on who edited an object.

## Files

Create: `packages/core/src/approval-wire.ts` (types, text format), `packages/gateway/src/approvals.ts`, `packages/node/src/activities/{create-approval,record-decision}.ts`, tests in each package.
Change: `packages/core/src/schema.ts` (`aa_approval`, `aa_approvers`, schema version `0.2.0`, field `aa_request_id`), `packages/admin/src/init.ts` (upgrade path, default approvers), `packages/gateway/src/{supervisor.ts,pipeline.ts}`, `apps/cli/src/checks/*` (doctor), `docs/specs/schema.md`, `docs/specs/agent-workflow.md`, `docs/SPIKES.md` (011).

## Schema (additive)

- `aa_approval` as in `schema.md`, plus **`aa_request_id`** (text, node): the workflow's `requestId`, used to make `createApproval` idempotent. Update `schema.md` in this package.
- `aa_settings.aa_approvers` (text, comma-separated participant ids, person-only). `init` sets it to the space owner(s). The approvers list must never contain an agent account ([ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) decision 5): in v1 the agent accounts are the accounts named in the configuration; refuse at `init`,
  ignore at the gateway, and report in `doctor`.
- Query `Approvals – Pending` created by `init` through the backend's saved-query API (check live that it is available; if not, say so and skip it with a doctor note).

## Behaviour

1. **`createApproval`** (node activity, writes as the agent's account): find an `aa_approval` with the same `aa_request_id`; if none, create it (requester, action summary, risk, `pending`, `aa_expires_at`) and post the chat message in the agent's chat:
   `⏳ Approval needed: @<handle> wants to <summary>. Risk: <risk>. React ✅ to allow or ❌ to deny. Expires <local time>. <link to the object>`; store `chatId/messageId` in `aa_message`. Returns `{ approvalObjectId, messageId }`. Retried calls return the same.
2. **Summary and risk** come from a pure function over the tool name, kind and input (command text truncated to 300 characters, file path, never file contents); risk: `high` for execute and delete, `medium` for edit and move, `low` otherwise. The text is data, never executed.
3. **Gateway: approvals watcher.** Watch `aa_approval` objects with status `pending` (initial state, then changes); for each, the chat watcher already sees updates of the message. On an update of a message whose id is a pending approval's `aa_message`: read it with full reactions (`chat.get`),
   and compute the decision:
   - consider only reactions ✅ and ❌ whose participant is in the current approvers list **and is not an agent account**;
   - one kind present: that decision; both present: **deny wins**; none: nothing yet;
   - the decider is the first approver (by reaction time if available, else id order) who gave the winning kind.
   Then send the update `anyagent.decision` to the workflow `{ requestId, approved, decidedBy }` with `updateId = decision:<requestId>` and `waitForStage: ACCEPTED` (confirm acceptance by awaiting `handle.result()`: a validator rejection is not thrown at `ACCEPTED`, see v0 WP5); treat `UnknownApproval` and "already decided" as success.
4. **Restart safety.** On start, for every pending approval, read its message once and apply step 3, so a reaction made while the gateway was down is applied. The `updateId` makes a repeat harmless.
5. **`recordDecision`** (node activity): sets `aa_status`, `aa_decided_by`, `aa_decided_at`, and posts a short reply to the approval message: `✅ approved by <name>` / `❌ denied by <name>` / `⌛ expired, denied`.
6. **Approval by editing the object's status** counts only if the backend shows who made the edit (v0 WP2 step 7, and spike 005's answer): then an edit to `approved` or `denied` by an approver is treated like a reaction. If the modifier is not visible, ignore status edits, and say so in the guide.
7. **Not an approver:** a ✅ by a non-approver changes nothing and produces no message (log at debug).
8. **`doctor`:** approvers present and not agent accounts; `approvalTtlMinutes` less than the turn timeout; an `aa_approval` stuck `pending` past its expiry (a lost workflow) is reported with its id.
9. **Spike 011 (approver identity):** a pure function `resolveApprovers(settings, agentAccounts, members)` and a table test for: person, owner, agent account (refused), a member who left, an id not in the space, an empty list (falls back to owners).

## Steps

1. Schema delta, `init` upgrade to `0.2.0` (idempotent, refuses newer), `resolveApprovers` with its table test.
2. Pure text, summary and risk functions with tests.
3. `createApproval` and `recordDecision` against the reference backend.
4. Gateway approvals watcher and decision rule as a pure function first, then wired.
5. Integration with the WP2 core in Temporal's test environment and the reference backend, using the fake harness asking for a write.
6. `doctor` checks and docs.

## Tests

- T-V1-WP3-01 `resolveApprovers` table (spike 011).
- T-V1-WP3-02 the decision rule: ✅ by approver, ✅ by non-approver, ❌ by approver, both kinds (deny wins), reaction removed before the check, reaction by an agent account, an approver who left the space, an empty approvers list.
- T-V1-WP3-03 `createApproval` is idempotent: two calls with one `requestId` create one object and one message.
- T-V1-WP3-04 summary and risk: long commands are truncated, no file contents, each kind maps to its risk.
- T-V1-WP3-05 end to end (Temporal, reference backend, fake harness): a write in `ask` mode creates the approval, an approver's ✅ lets the write happen, the object shows `approved`, `aa_decided_by` is the approver, and the chat has the confirmation.
- T-V1-WP3-06 same with ❌: no write, reason in the reply.
- T-V1-WP3-07 expiry (time skipping): denied, object `expired`, notice posted once.
- T-V1-WP3-08 restart: gateway stopped, ✅ added, gateway started: the decision is applied once.
- T-V1-WP3-09 a double reaction (✅ twice from two approvers, or the same one toggling) produces one decision and no error.
- T-V1-WP3-10 a non-approver's ✅ does nothing; the turn stays pending until an approver acts or it expires.
- T-V1-WP3-11 `init` on a v0 space upgrades to `0.2.0` without changing existing objects, twice; `doctor` reports the version and the approver checks.
- T-V1-WP3-12 (live, opt-in) the full flow on a real throwaway space with a second account as the approver.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/admin test
ANYAGENT_LIVE_ANYTYPE=1 pnpm --filter @anyagent/gateway test    # or NOT RUN with reason
pnpm check
```

## Achievements

- [ ] A person decides an `ask` request from Anytype with a reaction; nobody else can; expiry denies; restarts and repeats are harmless.
- [ ] The decision, its author and its time are recorded on the approval object, and the chat shows the result.
- [ ] The schema upgrade is additive and idempotent; `schema.md` matches.
- [ ] Spike 011's table is in the tests, and the status-edit path is either implemented or documented as unavailable.

## Stop and ask when

The backend cannot show which participant added a reaction (then no approval can be trusted: stop); reactions cannot be read after the fact; the saved-query API cannot create `Approvals – Pending` (skip and report).
