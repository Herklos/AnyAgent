# WP7: the `anybot` command, `run`, `doctor`, and the getting-started guide

**Goal.** A person who has Anytype, Temporal and one harness installed can follow one page, run four commands, and be talking to an agent. When something is wrong, `anybot doctor` says what and how to fix it.

**Depends on:** WP2 (admin library), WP5 (gateway), WP6 (node). **Unblocks:** WP8.

## Scope

In: the CLI (`init`, `agent create`, `agent list`, `run`, `doctor`, `version`), configuration discovery, graceful shutdown, the terms notice, the guide.
Out: `migrate` beyond a version check, `rebuild`, `status`, a Temporal dev-server launcher (documented, not built), packaging and installers.

## Read first

[ROADMAP v0](../../ROADMAP.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) (failure modes), [ADR 0012](../../adr/0012-any-anytype-sync-network.md) (doctor checks the network), [ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md), Q19 in [OPEN-QUESTIONS](../../OPEN-QUESTIONS.md),
Michel's [provider-terms research](https://github.com/Herklos/Michel/blob/main/docs/research/provider-terms.md), and the WP2, WP4, WP5, WP6 results.

## Files

Create: `apps/cli/src/{main.ts,config-discovery.ts,run.ts,doctor.ts,checks/*.ts,notice.ts,logging.ts}`, `apps/cli/test/*.test.ts`, `docs/GETTING-STARTED.md`, `CHANGELOG.md`.
Change: `README.md` (status and "Try it"), `docs/specs/agent-workflow.md` only if behaviour changed.
Dependencies: a small argument parser (pin exactly; record which) or none (Node's `util.parseArgs`; preferred).

## Commands

| Command | Does |
| --- | --- |
| `anybot init [--org <id>] [--check]` | for each org (or one): connect, `initOrg` (WP2), print what was created or already present; shows the terms notice once per org; `--check` validates the config and connects without writing |
| `anybot agent create <handle> --harness claude-code\|codex\|grok\|vibe [--model m] [--mode read_only\|full] [--workdir path] [--allowed-authors id,id] [--org id]` | `createAgent` (WP2); prints the chat id and where to open it in Anytype |
| `anybot agent list [--org id]` | handle, harness, mode, lifecycle, and any spec errors |
| `anybot run` | starts the workflow worker, the node worker for each org this node serves, and the gateway; logs JSON lines; stops on SIGINT or SIGTERM: stop watchers, stop accepting, let the worker drain for 30 s, then exit |
| `anybot doctor [--org id] [--json]` | the checks below; exit code 1 if any check fails, 0 if all pass or only warn |
| `anybot version` | version, Node, pinned Temporal SDK version |

Configuration is found, in order: `--config`, `ANYBOT_CONFIG`, `./anybot.config.yaml`, `~/.config/anybot/config.yaml`. Secrets only from the environment variables the config names.

## `doctor` checks (each has an id, a one-line result, and on failure the fix)

| Id | Checks | Fail means |
| --- | --- | --- |
| D1 | the config loads and validates | print every error |
| D2 | each org's backend answers; the key works (`whoami`); the adapter's `verified` flag (WP1) | key wrong or server down; warn if unverified |
| D3 | the account is a member of the space and has the role needed (write for the node key) | not joined, or read-only |
| D4 | the schema exists and its version is supported (not newer than the program) | run `init`, or upgrade anybot |
| D5 | the chat stream is enabled (a short probe), or polling is in use and says so | streams disabled in `anytype serve` |
| D6 | Temporal is reachable and the namespace exists | start Temporal or fix `temporal.address` |
| D7 | each harness used by an agent is installed (`--version`) and signed in or has its API key variable | missing or not signed in |
| D8 | for each `read_only` agent, the configuration guard (WP4) finds no auto-approving setting | names file and setting |
| D9 | each agent's `aa_workdir` exists on this node and is inside `node.workdirRoots` | fix the path or the roots |
| D10 | if the backend cannot show who changed an agent (WP2 step 7), warn: anyone with write access can change this agent's settings | share the space only with people you trust |
| D11 | one key is used for both read and write: warn | use a read-only key for the gateway when you can |
| D12 | the `aa_*` agents parse, with each error listed | edit the object |

## The terms notice (Q19)

Shown by `init` once per org (remember it in the state directory; it never blocks): "anybot drives the harness you installed (Claude Code, Codex, Grok Build) with your own login or API key. Each provider's terms apply, and some
providers restrict automated use of consumer subscriptions; an API key is the safest option. See <link>." The link is Michel's provider-terms research until anybot has its own.

## Steps

1. Argument parsing, config discovery, logging (JSON lines, `LOG_LEVEL`, no message text at the default level, never a secret).
2. `init`, `agent create`, `agent list` as thin wrappers over `@anybot/admin`, with human-readable output and non-zero exit codes on failure.
3. `doctor` with one module per check, each a pure function over injected dependencies (so each failure is tested without a live service).
4. `run`: build the backends, the gateway, the workers; wire shutdown; refuse to start if `doctor`'s D1 to D4 and D6 fail (print them).
5. `docs/GETTING-STARTED.md`: prerequisites (Node, pnpm or the packaged binary, Anytype and `anytype serve` with a bot account and keys, a Temporal dev server with a persistent database file, one harness), the four commands, what to expect, three
   troubleshooting entries taken from `doctor`. **Follow it literally on a clean machine or container and fix it until it works**; record what you ran.
6. `CHANGELOG.md` with the v0 entry drafted (the owner finalises the version).

## Tests

- T-WP7-01 argument parsing: every command and flag, unknown flags and missing arguments produce a clear error and exit code 2.
- T-WP7-02 config discovery order and precedence.
- T-WP7-03 each doctor check D1 to D12: one passing and one failing fixture, asserting the exact message and fix text.
- T-WP7-04 `doctor --json` is valid JSON with a stable shape; exit codes 0 and 1.
- T-WP7-05 `init` twice (reference backend): the second says "nothing to do"; the notice appears once.
- T-WP7-06 `agent create` then `agent list` shows the agent; a duplicate handle fails with exit code 1.
- T-WP7-07 `run` refuses to start on a failing D1 to D4 or D6, and starts with a fake backend and fake harness when they pass (process test).
- T-WP7-08 graceful shutdown: SIGTERM during a turn lets the worker drain, the process exits 0 within 35 s, and the in-flight message is not lost (it is answered or reported interrupted on the next start).
- T-WP7-09 logs never contain a key, a token or message text at the default level (scan the output of a full run for the test secrets).
- T-WP7-10 the getting-started guide: a script extracts its commands and runs them against the fake backend and fake harness (`docs-check` style); a failing step fails the test.

## Checks

```bash
pnpm --filter anybot test
pnpm --filter anybot exec node dist/main.js doctor --config examples/anybot.config.yaml --json | head
pnpm check
```

## Achievements

- [ ] `init`, `agent create`, `run` and `doctor` work end to end against the reference backend with the fake harness, and against the live pieces when available.
- [ ] Every failure `doctor` is meant to catch has a test with its exact message.
- [ ] The guide was followed literally on a clean environment and works.
- [ ] No secret, key or message text in logs.

## Stop and ask when

The guide cannot be followed without a step the owner has not approved (installing Anytype, creating an account, a login); `anytype serve` needs a different invocation than the research says.
