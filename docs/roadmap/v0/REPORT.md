# v0 release report

Date: 2026-11-07 (Europe/Paris). Prepared by the implementing cloud agent after WP0–WP8 on fakes.

## What shipped (code)

- Packages: `@anyagent/{core,backend,backend-anytype,admin,workflows,harness,gateway,node}`, CLI `anyagent` (`anybot` bin), `@anyagent/e2e`
- Workflow: `AnyBot` on own AgentCore; node activities; gateway; doctor D1–D12
- Harnesses in registry: `claude-code`, `codex`, `grok` (shipping: v1), `vibe` (shipping: v1), `fake` (tests)

## Automated suite (fakes + Temporal `createLocal`)

| Check | Result | Evidence |
| --- | --- | --- |
| 1 Owner message → reply + reactions | **PASS** (fakes) | T-WP8-01 |
| 2 Non-allowed author ignored | **PASS** (fakes) | T-WP8-02 |
| 3 `read_only` write refused; `full` allows; cred denied | **PASS** (fakes) | T-WP8-03 |
| 4 Pause silence; resume works | **PASS** (fakes) | T-WP8-04 (body-instruction visibility via fake script is limited; pause covered) |
| 5 Kill / interrupt then recover | **PASS** (simulated HarnessError); process `kill -9` of `anybot run` | **NOT RUN** in CI |
| 6 Rotation + session survival | **PASS** (fakes) | T-WP8-06 |
| 7 Doctor broken conditions | **PASS** (D6 inject); full hostile matrix | partial (D6 covered; others in WP7 unit tests) |
| 8 Two orgs | **NOT RUN** (v1 bonus) | — |

## Live procedure

| Item | Result |
| --- | --- |
| Live Anytype (spike 002) | **NOT RUN** — no throwaway `anytype serve` |
| Spike 004 Cloud / self-hosted min version | **NOT RUN** — SDK test server only |
| Live Claude Code `read_only` matrix | **NOT RUN** — no login/API key |
| Live Codex `read_only` matrix | **NOT RUN** |
| Live Grok / Vibe | **NOT RUN** — already deferred to v1 in WP4 |

**A shipped harness must have a live PASS row.** Therefore **v0 cannot claim Claude Code or Codex as live-shipped** until the owner (or a later agent) runs `e2e/live/README.md` and records PASS. Code paths and fake-harness proofs are in place.

## Measured numbers (for ADR 0019 / v1)

| Metric | Value | Source |
| --- | --- | --- |
| History events / message | ~11.18 | WP3 spike 006 (50 msgs) |
| History bytes / message | ~4.9 KB | WP3 spike 006 |
| Event age at delivery | not measured live | WP5 gateway tests only on SDK Temporal |
| Time to first reply (live) | **NOT RUN** | — |

## Known limitations

- Anyone with write access can change agent settings if last-modifier is not visible (D10 warn)
- `fetch` denied in `read_only`; replies are one final message; deliver can duplicate once across crash window
- Grok Build + Vibe: `shipping: v1` until live spike 007
- Adapter `verified: false` until spike 002

## Deviations

- Automated suite uses in-process Temporal + MemoryBackend + fake harness rather than a separate mock-heart process + `anybot run` child for CI reliability; `e2e/support/processes.ts` and `mock-heart-server.ts` exist for later process-level runs
- Full `kill -9` of `anybot run` not executed in CI

## Questions for the owner

1. Run live acceptance (`e2e/live/README.md`) twice per shipping harness before tagging a “live” v0, or tag a **fakes-only** v0 with harnesses marked provisional?
2. ADR 0019 v1 harness decision: keep own AgentCore given spike 006 numbers (~11 events / ~5 KB per message)?
3. Ship Claude Code / Codex after one live PASS each, or require the full matrix twice?
