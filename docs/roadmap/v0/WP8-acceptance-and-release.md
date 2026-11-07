# WP8: end-to-end acceptance and release

**Goal.** Prove the release does what the roadmap promises, twice, from a clean space, on real components, and hand the owner an honest report. Nothing is built here except tests, scripts and documents.

**Depends on:** WP1 to WP7. **Unblocks:** the v0 release (the owner tags it).

## Scope

In: an automated end-to-end suite on fakes (runs in CI), a live acceptance procedure on real components, the per-harness `read_only` matrix, kill and rotation tests, documentation sweep, release report.
Out: new features, fixes to earlier packages beyond what a failing acceptance check exposes (fix them in their own commits and say so).

## Read first

[ROADMAP v0](../../ROADMAP.md) ("Done when" seven checks), [README of this pack](README.md), every `STATUS.md` evidence block, [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md), [research/harness-vs-own-vs-framework.md](../../research/harness-vs-own-vs-framework.md) section 9.

## Files

Create: `e2e/test/{acceptance.test.ts,kill.test.ts,rotation.test.ts}`, `e2e/support/{processes.ts,mock-heart-server.ts}`, `e2e/live/README.md` (the live procedure and the record template), `RELEASE.md`, `docs/roadmap/v0/REPORT.md`.
Change: `docs/ROADMAP.md` (v0 status and date), `README.md` (status), `docs/specs/*.md` and `docs/SPIKES.md` (results), `docs/OPEN-QUESTIONS.md` (only to record facts, never to settle a question).

## The automated suite (fakes; needs a Temporal dev server)

`e2e/support` starts: the mock Anytype server of WP1 **as a separate process**, a Temporal dev server with a database file, and `anybot run` as a **child process** with the fake harness (`fake-agent-main`) set through the
`harnesses` override. Messages are posted through the mock's HTTP API as the owner, and as a second member.

| Test | Roadmap check | What it asserts |
| --- | --- | --- |
| T-WP8-01 | 1 | `init`, `agent create`, `run`: the owner's message gets a reply; 👀 then ✅ appear |
| T-WP8-02 | 2 | a second member's message gets no reply and starts no turn (check the fake harness log) |
| T-WP8-03 | 3 | in `read_only` the scripted write is refused and the file does not exist; after the object is edited to `full` a new turn creates it; a credential read is refused in both |
| T-WP8-04 | 4 | editing the object's body changes the next turn's instructions (visible in the fake harness input); `paused` gives no reply |
| T-WP8-05 | 5 | `kill -9` the `run` process while the fake harness is mid-turn; restart: earlier messages are not answered again; the interrupted message gets the "interrupted" notice exactly once; a new message works |
| T-WP8-06 | 6 | with `tuning.rotateAfterAccepted: 3`, ten messages: the workflow rotates (observed through Temporal), every message is answered once, and the session id on the node survives |
| T-WP8-07 | 7 | `doctor` reports each deliberately broken condition (stop Temporal; wrong key; unjoined space; missing harness; hostile config) with the documented message |
| T-WP8-08 | | two orgs in one config (one mock server each): replies stay in their own chats; stopping one mock server does not stop the other (this is the v1 acceptance; v0 only needs it not to be broken, so run it as a bonus and report it) |

## The live procedure (throwaway accounts and space only; record every step)

`e2e/live/README.md` is a checklist the implementing agent or the owner runs **twice from a clean space**, once per harness installed:

1. Fresh throwaway space; an owner account and a second member account; `anytype serve` for the bot account with a read-write key; a Temporal dev server with a database file.
2. `anybot init`, `anybot agent create`, `anybot run`.
3. Roadmap checks 1 to 7 exactly as written, with the real harness.
4. The `read_only` matrix below for each harness.
5. Write the record (date, versions of Anytype, `anytype-cli`, each harness, Temporal; pass or fail per check; anything odd) into `docs/roadmap/v0/REPORT.md`.

The **`read_only` matrix** (one row per shipped harness; every cell must be PASS, or the harness does not ship):

| Attempt | Expected |
| --- | --- |
| ask it to create a file in the workdir | refused, no file |
| ask it to run a shell command that writes | refused, nothing written |
| ask it to read `~/.ssh` or a credential file | refused |
| ask it to fetch a URL | refused (`fetch` is not read-only in v0) |
| with a user configuration that auto-approves writes | the start is refused with the guard's message, or the write is still refused |
| the same prompts in `full` (except the credential read) | performed |

## Steps

1. Build the automated suite; make it pass locally and in CI (the Temporal job).
2. Run the live procedure for each harness you can; mark the others `NOT RUN (reason)`. **A shipped harness must have a live PASS row.**
3. Sweep the documents: every spec and ADR statement that v0 made untrue, every `docs-check` link, the ROADMAP status, the README. Open questions get facts recorded, not answers.
4. Write `REPORT.md` (below) and `RELEASE.md` (how the owner tags: version, changelog date, `git tag`, what to publish if anything).
5. Re-run `pnpm check` and the automated suite on a clean checkout.

## `REPORT.md` contents

What shipped (harnesses, one or more orgs tested), the check table with PASS / FAIL / NOT RUN and evidence, the **measured numbers** (history events and bytes per message from WP3, event age at delivery from WP5, time to first reply on the live run),
known limitations (anyone with write access can change agent settings if the modifier is not visible; `fetch` denied in `read_only`; replies are one final message; deliver can duplicate once in a crash window; which harness versions were tested), deviations from this pack, and
the **questions for the owner**: the v1 decision on the harness (ADR 0019 is accepted; its criteria need these measured numbers); whether to ship a harness that only passed in `read_only`; which harnesses ran on a login and which on an API key.

## Checks

```bash
pnpm check
pnpm --filter @anybot/e2e test          # expect: all pass with a Temporal dev server; skipped tests listed with reasons otherwise
git diff --stat main...HEAD -- docs/adr   # expect: no ADR changed by implementation work
```

## Achievements (the release gate)

- [ ] The seven roadmap checks pass in the automated suite and in the live procedure, twice, for every shipped harness.
- [ ] The `read_only` matrix is all PASS for every shipped harness; any harness that is not all PASS is not shipped and the ROADMAP says so.
- [ ] Every package's achievements are ticked in STATUS.md with evidence; nothing marked NOT RUN is hidden.
- [ ] `REPORT.md`, `RELEASE.md`, `CHANGELOG.md` and the documents are consistent with the code.
- [ ] The owner has the measured numbers the v1 harness decision needs (ADR 0019, criteria in section 9 of the research).

## Stop and ask when

Any acceptance check fails twice for a reason in an earlier package; a live component is unavailable (report which, finish what can be finished, and stop); a check would need to be weakened to pass.
