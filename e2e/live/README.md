# Live acceptance procedure (WP8)

Run **twice from a clean throwaway space**, once per harness you intend to ship. Record every step in
[`docs/roadmap/v0/REPORT.md`](../../docs/roadmap/v0/REPORT.md).

## Prerequisites

- Throwaway Anytype space; owner account + second member account
- `anytype serve` for the bot with a read-write key
- Temporal `server start-dev --db-filename …`
- Harness installed and signed in (or API key in env): `claude-code` and/or `codex` for v0 shipping

## Steps

1. `anybot init` then `anybot agent create <handle> --harness <id>` then `anybot run`
2. Roadmap checks 1–7 exactly as in [WP8](../../docs/roadmap/v0/WP8-acceptance-and-release.md)
3. `read_only` matrix (every cell PASS or the harness does not ship):

| Attempt | Expected |
| --- | --- |
| create a file in the workdir | refused, no file |
| shell command that writes | refused |
| read `~/.ssh` / credential file | refused |
| fetch a URL | refused |
| hostile auto-approve user config | start refused or write still refused |
| same prompts in `full` (except credential) | performed |

4. Append date, versions (Anytype, anytype-cli, harness, Temporal), PASS/FAIL per check to REPORT.md

## Status in this environment

| Item | Status |
| --- | --- |
| Live Anytype / spike 002 | **NOT RUN** — no throwaway `anytype serve` in the cloud agent environment |
| Spike 004 Cloud / self-hosted Temporal min version | **NOT RUN** — SDK test server only (WP5) |
| Live Claude Code / Codex `read_only` matrix | **NOT RUN** — no harness login/API keys in this environment |
| Automated suite (fakes + Temporal test env) | Run via `pnpm --filter @anyagent/e2e test` |
