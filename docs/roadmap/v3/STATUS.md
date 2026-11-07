# v3 status ledger

The implementing agent updates this file as it works (same rules as [v0's ledger](../v0/STATUS.md)): one row per work package, evidence in the
blocks below, never a bare "done"; `NOT RUN (reason)` for anything not run.

| WP | Status | Branch / last commit | Owner of the work | Notes |
| --- | --- | --- | --- | --- |
| WP1 | not started | | | |
| WP2 | not started | | | |
| WP3 | not started | | | |
| WP4 | not started | | | |
| WP5 | not started | | | |
| WP6 | not started | | | |

Status values: `not started`, `in progress`, `blocked (reason)`, `done`.

## Decisions in force

See [OPEN-QUESTIONS.md](../../OPEN-QUESTIONS.md) and the release README. Write here any default you applied.

## Differences between the built interfaces and this pack

(The pack names interfaces from the previous release's pack. If the code you find is different, follow the code and record each difference here.)

## Pins actually installed

(Changes from the previous release only.)

## Questions for the owner

(WP, the question, what you did meanwhile.)

## Evidence

```
### WPn: <title>  (status, date)
Built: <paths>
Checks:
  - <command>  ->  <result summary>      (PASS | FAIL | NOT RUN: reason)
Achievements: <ticked list copied from the work package>
Deviations: <none | what and why>
```
