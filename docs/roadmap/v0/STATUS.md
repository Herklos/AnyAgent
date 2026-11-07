# v0 status ledger

The implementing agent updates this file as it works. One row per work package; evidence goes in the sections below, never in
a bare "done". A package is `done` only when every achievement is ticked and every check is recorded with its result.

| WP | Status | Branch / last commit | Owner of the work | Notes |
| --- | --- | --- | --- | --- |
| WP0 | not started | | | |
| WP1 | not started | | | |
| WP2 | not started | | | |
| WP3 | not started | | | |
| WP4 | not started | | | |
| WP5 | not started | | | |
| WP6 | not started | | | |
| WP7 | not started | | | |
| WP8 | not started | | | |

Status values: `not started`, `in progress`, `blocked (reason)`, `done`.

## Defaults in force for open questions

- **Q19** (subscription logins vs API keys): the owner's choice per agent; `init` shows the terms notice; API keys always work.
- **Q20** (workflow core): our own `AgentCore` behind the seam ([ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md)).

## Pins actually installed

(Fill in exact versions per package after WP0, and any deviation from the list in the README.)

## Questions for the owner

(Write each as: WP, the question, what you did meanwhile.)

## Evidence

Append one block per work package:

```
### WPn: <title>  (status, date)
Built: <paths>
Checks:
  - <command>  ->  <result summary>      (PASS | FAIL | NOT RUN: reason)
Achievements: <ticked list copied from the work package>
Deviations: <none | what and why>
```
