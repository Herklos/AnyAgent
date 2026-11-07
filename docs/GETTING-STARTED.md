# Getting started with anybot (v0)

Follow this page literally. Prerequisites, four commands, what to expect, and three fixes from `anybot doctor`.

## Prerequisites

1. **Node.js** `>=22.18` and **pnpm** `10.28.0` (or a packaged `anybot` binary when one exists).
2. **Anytype** desktop and a space you can write to; a bot account with an API key from `anytype serve`.
3. **Temporal** — a local Temporal server with a **persistent** database file (the Temporal CLI `temporal server start-dev --db-filename …` is enough for a laptop).
4. **One harness** installed and signed in (or with its API key in the environment): Claude Code, Codex, Grok Build, or Mistral Vibe. For CI / dry-runs you can use the built-in `fake` harness.

## Config

Copy [`examples/anybot.config.yaml`](../examples/anybot.config.yaml) to `./anybot.config.yaml` (or `~/.config/anybot/config.yaml`). Set:

- `temporal.address` / `temporal.namespace`
- `state.dir` (absolute or `~`)
- `node.handle` and `node.workdirRoots`
- each org’s `backend.url`, `space`, and the **env var names** that hold the keys (`readKeyEnv` / `writeKeyEnv`)

Put the secrets only in the environment. Discovery order: `--config`, `ANYBOT_CONFIG`, `./anybot.config.yaml`, `~/.config/anybot/config.yaml`.

## The four commands

From the repo (after `pnpm install && pnpm build`):

```bash
pnpm --filter anyagent exec node dist/main.js init --config examples/anybot.config.yaml
pnpm --filter anyagent exec node dist/main.js agent create chief --harness fake --config examples/anybot.config.yaml
pnpm --filter anyagent exec node dist/main.js doctor --config examples/anybot.config.yaml
pnpm --filter anyagent exec node dist/main.js run --config examples/anybot.config.yaml
```

Or, once `anybot` is on your `PATH` from the package `bin`:

```bash
anybot init
anybot agent create chief --harness claude-code
anybot doctor
anybot run
```

What to expect:

1. **`init`** — creates the `aa_*` types and `aa_settings` (or prints `nothing to do`). Shows the provider-terms notice **once per org**.
2. **`agent create`** — prints the agent object id and its chat id; open that chat in Anytype.
3. **`doctor`** — every check D1–D12 should be PASS or WARN; FAIL means fix before `run`.
4. **`run`** — starts the Temporal workers and the event gateway. Chat in the agent’s Anytype chat; you should see 👀 then a reply and ✅. Stop with Ctrl-C (SIGINT) or SIGTERM; the process drains for up to 30 seconds.

For local tests without Anytype, set `ANYBOT_BACKEND=memory` (reference backend in-process).

## Troubleshooting (from doctor)

| Symptom | Doctor | Fix |
| --- | --- | --- |
| `D1` config invalid | prints every schema error | Fix `anybot.config.yaml` until `anybot doctor` passes D1 |
| `D6` Temporal unreachable | connection error | Start Temporal (`temporal server start-dev --db-filename temporal.db`) or fix `temporal.address` |
| `D7` harness not installed | missing binary / not signed in | Install the harness and sign in, or set its API key env var |

## Verify

```bash
pnpm --filter anyagent test
pnpm --filter anyagent exec node dist/main.js doctor --config examples/anybot.config.yaml --json | head
pnpm check
```
