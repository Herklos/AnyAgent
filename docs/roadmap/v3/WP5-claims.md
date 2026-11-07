# v3 WP5: claims

**Goal.** In a group that opts in, agents can take ready tasks themselves, and when several try at once exactly one gets it, with the loser told who won, and nothing is assigned if the lead is unavailable. The truth is always the task's assignee in Anytype, never workflow memory, so rotation and crashes cannot cause a double assignment.

**Depends on:** v2 (tasks, nodes, identity). **Unblocks:** WP6. Independent of the permission and decision-model work.

## Scope

In: `aa_claims` use, the `anybot.claim` update on the lead's workflow, a serialised handler, the assignment activity, the `task_claim` tool, waking eligible agents, the deadline, notices, the core's definition of idle.
Out: auctions, bidding or load balancing ([ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md) says none), claims across groups, claiming by people (a person assigns directly), preferring one claimant over another.

## Read first

[ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md) (all of it), [specs/agent-workflow.md](../../specs/agent-workflow.md) (the `claim` update), [specs/schema.md](../../specs/schema.md) (`aa_group.aa_claims`, `aa_task`), v2 WP4 (task rules, `taskWrite`, waking, the tools), v2 WP6 (nodes and queues), `docs/specs/agent-core.md` (updates, idle, rotation).

## Files

Create: `packages/workflows/src/claims.ts` (the serialised handler), `packages/node/src/activities/assign-if-free.ts`, `packages/mcp/src/claim-tool.ts`, tests, `docs/specs/claims.md`.
Change: `packages/workflows/src/{contracts.ts,anybot-workflow.ts}` (the `claim` update), `packages/workflows/src/core/own-core.ts` (idle accounts for running update handlers), `packages/gateway/src/tasks.ts` (claimable wake), `packages/core/src/task-rules.ts` (the claim exception), `packages/node/src/tool-api.ts`, `docs/specs/{agent-workflow.md,agent-core.md,org-tools.md}`.

## Behaviour

1. **Opt-in:** only groups with `aa_claims` true (person-only). A claim must name a task in that group, in status `ready`, with no assignee.
2. **The claim:** tool `task_claim { taskId }` on the claimant's node sends the Temporal update **`anybot.claim`** `{ taskId, claimant, groupId, key }` to **the lead's workflow** by update-with-start (so the lead's workflow exists), `updateId = claim:<taskId>:<claimant>`, and returns the answer `{ granted: boolean, assignee, reason? }` to the harness. The same claim sent twice returns the same answer.
3. **Serialised handling:** in the lead's workflow the claim handler runs under a **workflow-level mutex** (a promise chain), because update handlers interleave at every `await` and the handler awaits the assignment activity. Inside the mutex: call activity `assignIfFree` on the **lead's node queue**, which reads the task fresh from Anytype and, only if status is `ready`, the assignee is empty, the claimant is a member of the group, the group has claims on, and the claimant is not the lead,
   writes `aa_assignee` (as the lead's account, with `expect` on the assignee version) and `aa_op_key`, sets status `in_progress`? **No:** status stays `ready`; the assignee moves it to `in_progress` itself (the writer rules of v2 WP4 are unchanged). It returns `{ granted, assignee }`. The refusal reasons are exact strings: `not-ready`, `already-assigned:<handle>`, `not-a-member`, `claims-off`, `lead-cannot-claim`.
4. **Why Anytype is the truth:** the mutex serialises claims within one run, but a rotation or a second run starts with an empty mutex. The only authority is the `assignIfFree` read-and-write against Anytype's current `aa_assignee`; a second claimant after a rotation reads the winner and is refused.
5. **The core stays correct under rotation:** `rotation.idle` is false while any update handler (a claim in the mutex or waiting for it) is running; the gateway never closes a workflow that is deciding a claim.
6. **Deadline:** if the lead's workflow cannot answer within `tuning.claimDeadlineSec` (default 60: the lead is not live, its node is offline, Temporal is slow), the claimant's tool call fails with `lead-unavailable` and **nothing is assigned**. A late grant that arrives after the deadline is still recorded in Anytype by the lead's node; the claimant learns of it from the next `objectChanged` wake (it is the assignee), so a late win is not lost and not doubled.
7. **Waking claimants:** when a task in a claims group becomes `ready` with no assignee, the gateway wakes every eligible member except the lead with `objectChanged` (`claimable`); they may race; the number of agents woken is capped at `tuning.maxClaimantsWoken` (default 5, chosen in handle order rotating by task id so the same agents do not always win the race).
8. **Notices:** the lead's node posts `🙋 @x took <task>` for the winner (one line, link); losers see the refusal in their tool result only; no notice for refusals.
9. **Permissions:** claiming needs no permission id; group membership and the group's `aa_claims` are the whole authority. The lead's `taskWrite` accepts the claim exception to "agents never assign themselves": the assignment is written by the lead's account, on behalf of the claimant.
10. **Visibility:** a claim is a normal object change with an op key; v2's self-change skip applies (the assignee is woken by the assignment, the lead is not woken by its own write).

## Steps

1. `claims.ts` mutex and handler as pure-ish code, tests first with a fake activity that sleeps, to prove serialisation.
2. `assignIfFree` against the reference backend, with all refusal reasons.
3. The update, the tool, and the claimable wake with the cap and rotation of order.
4. Idle accounting in the core and its contract test.
5. Deadline and late-grant handling.
6. Race tests, then live with two real agents.

## Tests

- T-V3-WP5-01 (Temporal) five claimants send claims for one task at the same instant: exactly one `granted`, four `already-assigned:<winner>`, one write in Anytype.
- T-V3-WP5-02 refusals, one each: not ready (status `backlog`), already assigned, not a group member, group without claims, the lead claiming.
- T-V3-WP5-03 idempotency: the same claim twice (update id) returns the same answer and writes once; the winner claiming again gets `granted` with itself and writes nothing.
- T-V3-WP5-04 (Temporal) rotation: the lead's workflow is closed and restarted between a grant and a second claim: the second is refused from Anytype's assignee, no double assignment.
- T-V3-WP5-05 (Temporal) `rotation.idle` is false while a claim is being handled; the gateway does not close the workflow.
- T-V3-WP5-06 lead unavailable: no live lead, or its node stopped: the claim fails with `lead-unavailable` at the deadline and nothing is assigned; when the node returns a late write is not repeated.
- T-V3-WP5-07 wake: a task turning `ready` wakes at most the capped number of eligible members, never the lead, in rotating order; a task that is not claimable wakes nobody extra.
- T-V3-WP5-08 notices: one `🙋` line for the winner; none for refusals.
- T-V3-WP5-09 the handler never holds the mutex past an activity failure (a failing `assignIfFree` releases it and the next claim proceeds).
- T-V3-WP5-10 (live, opt-in) two real harness agents race for tasks on a throwaway space: every task has exactly one assignee.

## Checks

```bash
pnpm --filter @anybot/workflows test && pnpm --filter @anybot/node test && pnpm --filter @anybot/mcp test && pnpm --filter @anybot/gateway test
pnpm check
```

## Achievements

- [ ] Under concurrent claims exactly one agent is assigned each task, in every test including across a rotation.
- [ ] No claim is lost silently: a refusal always names its reason, an unavailable lead assigns nothing, a late win is recorded once.
- [ ] A workflow deciding a claim is never rotated.
- [ ] `docs/specs/claims.md` states the refusals and the guarantees.

## Stop and ask when

The backend cannot make the assignee write conditional (then two lead-side writes could both succeed if two runs exist: record it and tell the owner what that allows); update handlers turn out not to interleave in the SDK version in use (the mutex is then redundant, but keep the test); the owner wants preference rules for claimants.
