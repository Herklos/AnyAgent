# Spike 007: per-harness `read_only` that holds

**Question.** For each shipped harness, which flags and host checks keep `read_only` from writing or reading credentials, including under a hostile user config?

**Depends on.** Installed harness CLIs and owner logins (opt-in). Michel adapters at `402865d`.

## Results (this environment)

| Harness | Live | Notes |
| --- | --- | --- |
| Claude Code | **NOT RUN** | `ANYBOT_LIVE_CLAUDE` unset |
| Codex | **NOT RUN** | `ANYBOT_LIVE_CODEX` unset |
| Grok Build | **NOT RUN** → **moves to v1** | Michel audit G172; not controlled live here |
| Mistral Vibe | **NOT RUN** → **moves to v1** | Headless kind + fixtures tested; live schema/credential paths unknown |

Fixture coverage (no live binary): fake ACP agent (T-WP4-03/04/08/09 via acp-fake), Codex fixture peer, vibe fake CLI (T-WP4-13a), config guard + controlled home unit tests.

## Table corrections

Until a live pass, the WP4 per-harness table remains a **hypothesis** for Codex sandbox names, Grok `--sandbox`, and Vibe `--enabled-tools` names. Vibe read-tool allowlist used in code: `read_file`, `list_dir` (unverified).

## What this spike did not prove

- Refresh-token invalidation on copied logins
- Real credential path basenames per harness
- Whether Vibe `ask` runs read tools without approval headless
