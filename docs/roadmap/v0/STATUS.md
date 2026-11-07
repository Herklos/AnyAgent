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

## Decisions in force

Settled by the owner (2026-11-07), no longer open:

- **Q19**: both subscription logins and API keys, per agent, where the harness offers both ([ADR 0020](../../adr/0020-harness-adapter-kinds.md)).
- **Q20**: our own `AgentCore` behind the seam; the harness is reconsidered at v1 ([ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md)).
- **Q17**: Claude Code, Codex, Grok Build and Mistral Vibe; Grok Build and Vibe ship only if their live check passes.

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
