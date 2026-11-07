# v1 WP8: end-to-end acceptance and release

**Goal.** Prove v1 does what the roadmap promises on real components, with no regression of v0, and hand the owner an honest report. Only tests, scripts and documents are written here.

**Depends on:** WP1 to WP7. **Unblocks:** the v1 release (the owner tags it).

## Scope

In: the automated v1 suite on fakes, the live procedure, the `ask` matrix per harness, regression of v0, the documentation sweep, the report.
Out: new features; fixes to earlier packages beyond what a failing check exposes (fix in its own commit and say so).

## Read first

[ROADMAP v1](../../ROADMAP.md) ("Done when"), [the v1 README](README.md), the [v0 WP8](../v0/WP8-acceptance-and-release.md) (the harness, the live procedure, the report format, which this extends), every v1 STATUS block, ADR 0021 (WP1's outcome).

## Files

Create: `e2e/test/v1/{ask.test.ts,schedule.test.ts,stop.test.ts,openai.test.ts,two-orgs.test.ts}`, `e2e/live/README-v1.md`, `RELEASE-v1.md`, `docs/roadmap/v1/REPORT.md`.
Change: `docs/ROADMAP.md` (v1 status), `README.md`, `CHANGELOG.md`, specs and `docs/SPIKES.md`, `docs/OPEN-QUESTIONS.md` (facts only).

## The automated suite (fakes; needs a Temporal dev server)

Same process layout as v0's suite (mock Anytype server, Temporal dev server with a database file, `anyagent run` as a child with the fake harness and a fake OpenAI-compatible server).

| Test | Roadmap v1 check | What it asserts |
| --- | --- | --- |
| T-V1-WP8-01 | approvals | `ask`: a write waits; an approver's ✅ allows it and the object shows `approved` with the approver; ❌ refuses; no reaction expires into a refusal (time-skipped); a non-approver's ✅ does nothing |
| T-V1-WP8-02 | approvals | `kill -9` while an approval is pending, restart, then ✅: the call proceeds once |
| T-V1-WP8-03 | schedules | a weekday schedule fires in its time zone, posts with the `🕘` line, `aa_next_run` and `aa_last_run` are written; disabling it stops it |
| T-V1-WP8-04 | models | an agent on the fake OpenAI-compatible server reads a file, refuses a write in `read_only`, asks in `ask`, writes in `full` |
| T-V1-WP8-05 | stop | `/stop` ends a running turn, drops the queue, denies a pending approval, posts one notice |
| T-V1-WP8-06 | two orgs | two orgs, one agent each: replies, approvals, `/stop` and schedules stay in their org; one org's backend stopped does not stop the other |
| T-V1-WP8-07 | status | `anyagent status` shows running, waiting approval, idle and paused correctly through the above |
| T-V1-WP8-08 | regression | the whole v0 suite still passes unchanged |
| T-V1-WP8-09 | upgrade | a space created by v0 is upgraded by `init` to `0.2.0` with its agent still working and nothing lost |

## The live procedure (throwaway accounts and space only)

`e2e/live/README-v1.md`, run **twice from a clean space**: v0's live procedure first (regression), then:

1. **`ask` matrix**, once per installed harness that has permission callbacks (Claude Code, Codex, Grok Build if it ships): a write request creates an approval; ✅ by the approver performs it; ❌ refuses; no answer expires into a refusal; a ✅ from a non-approver does nothing; a second approver clicking after the first changes nothing.
   Mistral Vibe (headless) must be **refused** `ask` with the notice.
2. **Models:** an agent on a real `llama-server --jinja` (record the model and flags) and, if the owner supplies a key, on one cloud endpoint, through `read_only`, `ask` and `full`.
3. **Schedule:** a one-minute schedule posts; the real `aa_next_run` appears in Anytype.
4. **`/stop`** during a real harness turn on each shipped harness.
5. **Two orgs** with two real spaces.
6. **Variants:** Temporal Cloud and the self-hosted network (WP7), if the owner supplied them; otherwise NOT RUN with the reason.
7. Record dates, versions and results in `REPORT.md`.

## Steps

1. Build the automated suite, make it pass locally and in CI.
2. Run the live procedure for everything available; mark the rest `NOT RUN (reason)`. A harness or variant shipped as supported must have a live PASS.
3. Sweep documents: specs and ADRs v1 made untrue, `docs-check`, the ROADMAP status, README, CHANGELOG, `schema.md` for every field added.
4. Write `REPORT.md` and `RELEASE-v1.md`.
5. Re-run `pnpm check` and the automated suite on a clean checkout.

## `REPORT.md` contents

What shipped (harnesses with `ask`, endpoints and models tested, variants verified), the check table with PASS, FAIL or NOT RUN and evidence, measured numbers (events per approval, event age at delivery, time from ✅ to resumed turn, schedule start lateness), known limitations
(who can edit `aa_approvers` if the modifier is not visible, the `/stop` queue-dropping semantics, notice rate limit, headless harnesses cannot `ask`), deviations from the pack, and the questions for the owner (ADR 0021 confirmation if still open; whether `remember` is wanted next).

## Checks

```bash
pnpm check
pnpm --filter @anyagent/e2e test
git diff --stat main...HEAD -- docs/adr    # expect: only the ADRs this release was meant to change (0020, 0021)
```

## Achievements (the release gate)

- [ ] Every v1 "Done when" item passes in the automated suite and live, twice, or is NOT RUN with the owner told.
- [ ] No v0 regression (T-V1-WP8-08) and v0 spaces upgrade cleanly (T-V1-WP8-09).
- [ ] Every shipped harness has an `ask` matrix of all PASS, or does not ship `ask`.
- [ ] `REPORT.md`, `RELEASE-v1.md`, `CHANGELOG.md`, `schema.md` and the specs match the code.

## Stop and ask when

An approval can be decided by someone who is not an approver in any test (stop: a security defect); a check fails twice for a reason in an earlier package; a live component is unavailable (report what, finish the rest).
