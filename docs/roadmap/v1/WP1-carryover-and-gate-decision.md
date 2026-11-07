# v1 WP1: v0 carry-over and the approval-gate decision

**Goal.** Start v1 from facts: list what v0 left undone, decide with data whether the approval gate is written by us or taken from `@temporalio/agent-harness` (the decision [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md) deferred to this point),
and settle the engine pins before anything is built on them.

**Depends on:** v0 released. **Unblocks:** WP2.

## Scope

In: reading the v0 report, a carry-over list, an evaluation of the six criteria with evidence, an optional thin harness-backed `AgentCore` spike, the decision as an ADR, the pin and `AGENTS.md` update.
Out: writing the approval gate itself (WP2), adopting the harness for anything beyond what the criteria allow.

## Read first

[ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md) (decision 3), [research/harness-vs-own-vs-framework.md](../../research/harness-vs-own-vs-framework.md) section 9 (the six criteria), [research/temporal-agent-harness.md](../../research/temporal-agent-harness.md),
`docs/roadmap/v0/REPORT.md` and [v0 STATUS.md](../v0/STATUS.md), `docs/specs/agent-core.md` (the seam and `runCoreContract`), [AGENTS.md](../../../AGENTS.md) rule 8.

## Files

Create: `docs/roadmap/v1/CARRYOVER.md`, `scripts/harness-criteria.mjs`, `docs/adr/0021-approval-gate-implementation.md`, and, only if the harness is evaluated for adoption, `spikes/021-harness-core/` (a thin implementation of `AgentCore` over the harness, run through `runCoreContract`).
Change: `docs/research/harness-vs-own-vs-framework.md` (a dated "Evaluation at v1" section), `AGENTS.md` rule 8 and `docs/research/temporal-agent-harness.md` if the pins or the dependency change, `docs/adr/README.md`, `docs/OPEN-QUESTIONS.md` (facts only).

## Steps

1. **Carry-over.** Read the v0 REPORT and STATUS. In `CARRYOVER.md` list, one line each with its source: harnesses that moved to v1 (Grok Build, Vibe, or others) and why; every `NOT RUN` item; every known limitation; every deviation from the v0 pack; anything the owner asked
   to be revisited. For each, say which v1 work package takes it, or "later". Nothing is silently dropped.
2. **Re-run v0.** Run the v0 automated suite and live procedure's cheap parts on the v0 release tag, so v1 starts from a known state; record the result in STATUS.md.
3. **Evaluate the six criteria** with `scripts/harness-criteria.mjs`, which installs the latest `@temporalio/agent-harness*` into a scratch directory (never into the repository) and checks, printing evidence per criterion:
   (1) the declared range of `@temporalio/*` versus the SDK version we run, and whether the package still imports `@temporalio/common/lib/time.js` (the deep import); (2) whether a public, documented API lets an external permission request reach the approval gate
   (search the package's types for an exported method; `@internal` markers do not count); (3) whether `continueAsNew` appears; (4) the history events per message of a thin harness-backed core versus ours (needs the spike below and a Temporal server); (5) how many API-breaking changes landed across the last
   two minor releases (read the changelog and diff the exported types); (6) whether the `runCoreContract` suite passes on the harness-backed core. Criteria 4 and 6 need the spike; build it only if criteria 1, 2 and 5 do not already fail (if any of them fails, record that and stop evaluating: the answer is "own gate").
4. **The spike (conditional).** `spikes/021-harness-core/` implements `AgentCore` over `defineAgent` with the same update, signal and query names as ours and passes `runCoreContract`. Measure events per message against v0's number. Say what it did not prove.
5. **Decide in ADR 0021.** Outcome A: "own gate", with the evidence. Outcome B: "adopt the harness behind the seam for the core and the gate", with the pin it requires, the migration path for running workflows (rotate idle runs, then deploy), and the exit plan.
   The criteria decide, but a change of the engine pin or a new dependency is the owner's call: write the recommendation and the evidence, set the ADR to `proposed`, and **stop for the owner's answer** before WP2 (WP2 can start on the own gate meanwhile only if the recommendation is A).
6. **Pins.** If the outcome is A and nothing requires 1.24.0, you may propose moving the `@temporalio/*` pin to the current SDK in its own commit with the full test suite; do it only with the owner's go-ahead. Update `AGENTS.md` rule 8 in the same commit as any change.

## Tests

- T-V1-WP1-01 `harness-criteria.mjs` runs against a fixture package directory and reports each criterion pass or fail with the evidence line (a fixture with the deep import fails criterion 1; one with an exported permission method passes 2; one with `continueAsNew` passes 3).
- T-V1-WP1-02 the script refuses to install into the repository (it fails if its target is inside the repo root).
- T-V1-WP1-03 (only if the spike is built) `runCoreContract` passes on the harness-backed core, and the events-per-message table is produced.
- T-V1-WP1-04 `CARRYOVER.md` covers every `NOT RUN` and every limitation named in the v0 REPORT (a script compares the REPORT's "known limitations" list to the carry-over file's lines).

## Checks

```bash
node scripts/harness-criteria.mjs --fixture test/fixtures/harness-pass    # expect: all criteria shown, exit code 0
node scripts/harness-criteria.mjs --latest                                 # expect: a criteria table with evidence; exit 0 either way (it informs, the ADR decides)
pnpm check
```

## Achievements

- [ ] `CARRYOVER.md` lists every open item from v0 with its owner package.
- [ ] The six criteria are evaluated with evidence, and the decision is written in ADR 0021 (accepted if the owner confirmed it).
- [ ] The pins and `AGENTS.md` are consistent with the decision, in their own commit.
- [ ] The v0 suite is green on the starting point.

## Stop and ask when

The recommendation changes the engine pin or adds a dependency; a v0 limitation turns out to be a defect that blocks v1 (for example the approval path cannot work with the core as built).
