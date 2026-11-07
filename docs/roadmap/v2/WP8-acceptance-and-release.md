# v2 WP8: end-to-end acceptance and release

**Goal.** Prove v2 tells its story, the whole team story on separate processes and with each account setup, with no regression of v0 or v1, and hand the owner an honest report. Only tests, scripts and documents are written here.

**Depends on:** WP1 to WP7. **Unblocks:** the v2 release (the owner tags it).

## Scope

In: the automated team suite on fakes with a separate gateway and two node processes, the live procedure on two real machines, the three account setups, the loop and failure cases, regression, the documentation sweep, the report.
Out: new features; fixes to earlier packages beyond what a failing check exposes (own commit, say so).

## Read first

[ROADMAP v2](../../ROADMAP.md) ("Done when"), [the v2 README](README.md) (the story), the [v1 WP8](../v1/WP8-acceptance-and-release.md) and [v0 WP8](../v0/WP8-acceptance-and-release.md) (harness, live procedure, report format), every v2 STATUS block.

## Files

Create: `e2e/test/v2/{team-story.test.ts,accounts.test.ts,loop.test.ts,nodes.test.ts,tasks.test.ts,permissions.test.ts,migration.test.ts}`, `e2e/live/README-v2.md`, `RELEASE-v2.md`, `docs/roadmap/v2/REPORT.md`.
Change: `docs/ROADMAP.md`, `README.md`, `CHANGELOG.md`, specs, `docs/SPIKES.md`, `docs/OPEN-QUESTIONS.md` (facts only).

## The automated suite (fakes)

Processes: the mock Anytype server (one per account endpoint), a Temporal dev server with a database file, **`anybot gateway` and two `anybot node` processes** (node-a and node-b), the fake harness with scripts per agent. Three agents: **primary** (group lead), **chief**, **specialist**.

| Test | Roadmap v2 check | What it asserts |
| --- | --- | --- |
| T-V2-WP8-01 | the story | a person writes with no mention; the primary replies and creates an `aa_task` (lead = chief, origin message linked); the chief assigns the specialist and mentions them; the specialist (on node-b) works, asks one approval, the approver's ✅ allows it, `aa_result` is written, status `review`; the chief sets `done`; the answer is in the group chat; every transition has its notice and no write was duplicated |
| T-V2-WP8-02 | account setups | the story above, repeated with: one shared bot account; two accounts in a pool; one account per agent; a mix. Attribution is right in each (handle tags where shared) and nothing is attributed to a person |
| T-V2-WP8-03 | routing | `lead`, `everyone`, `none` routing and mentions behave per the table; a mention of a non-member is ignored; an unattributed agent message is never routed |
| T-V2-WP8-04 | loop guard | two agents mentioning each other stop at `aa_max_hops` with one notice; a person's message resumes; a gateway restart rebuilds the count |
| T-V2-WP8-05 | nodes | stop node-b: a message for its agent gets one `not responding` notice; restart it: a resend works; edit `aa_node` to move the agent to node-a: the next turn runs there with a new session |
| T-V2-WP8-06 | tasks | every illegal transition and writer is refused with the reason; two simultaneous status writes: one wins, the other is refused; a change never wakes its author |
| T-V2-WP8-07 | defaults | an agent creates a task and its own schedule by default; with `none` it can do neither and the person is told once; a person-only key written through every tool path is refused |
| T-V2-WP8-08 | hierarchy and prompts | an edit of a shared rule between two turns changes the second turn; "what was this agent told" is answerable from the turn log |
| T-V2-WP8-09 | migration | a space built by the v1 release is upgraded by `migrate` to `0.3.1` with its v1 agent still working in its direct chat, and nothing lost |
| T-V2-WP8-10 | regression | the whole v0 and v1 suites pass unchanged |
| T-V2-WP8-11 | two orgs | the v1 two-org isolation checks pass with groups, tasks and two nodes |

## The live procedure (throwaway accounts and space only; two machines)

`e2e/live/README-v2.md`, run **twice from a clean space**: v1's procedure first (regression), then:

1. Machine A runs Temporal and `anybot gateway`; machines A and B each run `anybot node` (`node register` first); real `anytype serve` endpoints as the config says.
2. The story with real harnesses: primary and chief on one harness, the specialist on another, on B. The specialist's approval is decided by a second real account.
3. Each account setup, once (the shared one is the cheapest to set up; record how long each takes).
4. Stop B mid-turn; observe the notice and recovery.
5. Move the specialist to A by editing `aa_node`.
6. A deliberate ping-pong between two agents.
7. Record dates, versions, timings (first reply, approval to resume, task transition latency) and the spike 003, 008 and 010 results in `REPORT.md`.

## Steps

1. Build the suite (processes, scripts per agent), make it pass locally and in CI.
2. Run the live procedure; mark anything unavailable `NOT RUN (reason)`. A supported harness or setup needs a live PASS.
3. Sweep documents: `schema.md` (every field), specs, ADRs v2 made untrue, `docs-check`, the guide (two machines), ROADMAP, README, CHANGELOG.
4. Write `REPORT.md` and `RELEASE-v2.md`.
5. Re-run `pnpm check` and the suite on a clean checkout.

## `REPORT.md` contents

What shipped (harnesses with org tools, account setups verified, nodes tested), the check table with evidence, measured numbers (events per turn in a group, event age at delivery, task transition latency, `anytype serve` cost from spike 003), the answers of spikes 008 and 010, known limitations (the trust model between nodes; headless harnesses have no org tools; who can edit person-only fields if the modifier is not visible;
the `aa_permissions_ask` list is refused until v3), deviations, and the questions for the owner (whether to turn on claims or agent-created agents next, and what the spike 010 result means for their setup).

## Checks

```bash
pnpm check
pnpm --filter @anybot/e2e test
git diff --stat main...HEAD -- docs/adr    # expect: only ADRs this release meant to change
```

## Achievements (the release gate)

- [ ] The story passes in the automated suite and live, twice, for each account setup that is declared supported.
- [ ] No v0 or v1 regression, and v1 spaces migrate cleanly.
- [ ] The loop guard, the offline-node notice, the task rules and the permission defaults each hold under their adversarial tests.
- [ ] `REPORT.md`, `RELEASE-v2.md`, `CHANGELOG.md`, `schema.md` and the specs match the code.

## Stop and ask when

An agent can write a person-only field, or an agent can be taken for a person, in any test (stop: a security defect); two nodes can run the same turn; a check fails twice for a reason in an earlier package; a live machine is unavailable (report which, finish the rest).
