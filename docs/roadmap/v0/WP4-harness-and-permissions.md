# WP4: harness adapters, permission rules, and a `read_only` that holds

**Goal.** One interface runs a turn on Claude Code, Codex, Grok Build or Mistral Vibe, and in `read_only` mode nothing is written or executed, **even when the harness's own configuration would approve a
call by itself**, and credential files are never read in any mode. Includes **spike 007**.

**Depends on:** WP0 (independent of WP1 to WP3). **Unblocks:** WP6.

## Scope

In: copy Michel's adapters for Claude Code, Codex and Grok Build with provenance, and write a new `headless-cli` adapter kind for Mistral Vibe ([ADR 0020](../../adr/0020-harness-adapter-kinds.md)); the fake agent for tests; the permission rules and the floor; per-harness `read_only` mapping; a controlled home and a configuration guard;
live checks. Out: the OpenAI-compatible adapter and its MCP bridge, OpenCode, `ask` and `auto` modes, MCP servers for agents, approvals through Anytype, computer use.

## Read first

[ROADMAP v0](../../ROADMAP.md) (harness bullet), [ADR 0010](../../adr/0010-reuse-michel-adapters-and-the-npm-harness.md) (decisions 1 and 2: copy adapters and `approval.ts`), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md),
[research/michel-reuse.md](../../research/michel-reuse.md), [ADR 0020](../../adr/0020-harness-adapter-kinds.md), [research/mistral-vibe.md](../../research/mistral-vibe.md), and in `Herklos/Michel@402865d`: `packages/harness/adapters/AGENTS.md`, `src/{types,jsonrpc-child,acp,codex,registry,fake-agent,fake-agent-main,index}.ts`,
`docs/research/sandbox-spike.md` (the per-harness read-only table), `docs/AUDIT.md` G172, G176, G247, `packages/core/src/{command-floor,command-policy}.ts` with their tests,
`packages/temporal/workflows/src/approval.ts` and `contracts.ts` (`READ_ONLY_KINDS`).

## Files

Create: `packages/harness/src/{types.ts,jsonrpc-child.ts,acp.ts,codex.ts,registry.ts,fake-agent.ts,fake-agent-main.ts,home.ts,config-guard.ts,index.ts}`, `packages/harness/test/*.test.ts`,
`packages/core/src/floor/{command-floor.ts,command-policy.ts}` and their tests, `packages/core/src/permission.ts` and its test, `THIRD_PARTY_NOTICES.md`, `spikes/007-harness-readonly/README.md`.
Change: `docs/research/michel-reuse.md` (what was copied, at which commit, what was changed), `docs/SPIKES.md` (007).
Must not change: the OpenAI adapter files are **not** copied; do not copy `opencode` code or its dependency.

## Provenance rule

Every copied file starts with a header: source repository, path, commit (`402865d`), licence (Apache-2.0, same as anybot), and a one-line list of changes. `THIRD_PARTY_NOTICES.md` lists them. Copy, then change
as little as possible: import paths, removal of unused harnesses, the v0 permission modes. Keep Michel's tests that still apply and add ours. Dependencies: `@agentclientprotocol/claude-agent-acp` exactly `0.99.1`; nothing else new.

## The permission rules (pure, `packages/core/src/permission.ts`)

```ts
export type Mode = "read_only" | "full";
export interface PermissionRequest { toolName: string; kind?: "read"|"search"|"think"|"fetch"|"edit"|"delete"|"move"|"execute"|"other"; title?: string; rawInput?: unknown; home?: string }
export function decidePermission(mode: Mode, req: PermissionRequest): { allow: boolean; reason: string }
```

1. **The floor first, in every mode:** `hardFloorReason(command)` for execute requests and `fileFloorReason(toolName, rawInput)` for file tools deny with their reason (credential files, key stores, the harness's own control files, destructive commands).
2. `read_only`: allow only kinds `read`, `search`, `think`. **`fetch` is not allowed in v0**: a read-only agent that can fetch URLs can send what it read to a URL an attacker chose. This is a deliberate deviation from Michel's `READ_ONLY_KINDS`
   (which includes `fetch`); the owner can change it. Everything else is denied with the reason `read-only agent`.
3. `full`: allow everything the floor allows.

## Per-harness `read_only` (use the harness's own mode **and** the host's denial)

| Harness | Start | `read_only` | `full` |
| --- | --- | --- | --- |
| Claude Code (ACP, `@agentclientprotocol/claude-agent-acp`) | ACP session in the permission mode that asks (`default`) | host denies per `decidePermission`; no Claude-side allow rules may exist (see the guard) | host allows; `bypassPermissions` is unavailable as root (Michel spike 0.3), so use `default` with the host allowing |
| Codex (`codex app-server`) | `approvalPolicy: untrusted` so every command reaches the host | sandbox `read-only` | sandbox `danger-full-access` |
| Grok Build (`grok agent stdio`, flags `--no-auto-update [-m model]`) | permission mode that asks | `--sandbox read-only` (or `strict`) | `--sandbox off` |
| Mistral Vibe (**headless CLI**, `vibe -p --output json` or `streaming`; hypothesis from [the research](../../research/mistral-vibe.md)) | `--agent ask` (never the default `accept-edits`, which auto-approves file edits), `--enabled-tools <read tools>`, no `--auto-approve`, no `--trust`, `--max-turns`, `--time-limit`, `VIBE_HOME` pointing at the controlled home | approvals are denied (headless), so only the allowlisted read tools run | `--agent auto-approve` (`--auto-approve`) |

Michel has run **none of Codex's mapping and Grok for real** (audit G176, G172), and nobody has run Vibe here. Treat the table as a hypothesis until spike 007 confirms it live. A headless harness has no permission callback, so the host cannot answer calls one by one: its `read_only` is entirely the flags, the allowlist and the controlled home.

## Steps

1. **Copy and make it build.** Bring over the listed adapter files and the floor with provenance headers, drop the other harnesses from `registry.ts`, make the existing fake-agent tests pass.
2. **Interface for the node.** Keep `HarnessSession` (`prompt(input, sink, onPermission)`, `cancel`, `close`, `kill`) and `SessionInit`. Add `startSession(harnessId, init)` in the registry that maps `approvalMode` to the table above.
3. **Controlled home** (Vibe: `VIBE_HOME`; the others: `HOME` and their config-dir variables). `home.ts`: for each agent a directory `<state.dir>/agents/<spaceId>/<agentId>/home`. The harness is started with `HOME` (and the harness's own config-dir variables) pointing there. A descriptor lists
   `credentialPaths`: the home-relative files that carry the login (for example Claude's credentials file, Codex's `auth.json`, Grok's token file; find the real names live). The node copies those, read-only, mode 0600, from the real home;
   it writes a minimal config of its own for the mode. **Both login and API key must work (Q19, settled):** a login is copied as above, an API key is passed through the environment variable the descriptor names (Vibe: `MISTRAL_API_KEY`, saved by Vibe in `VIBE_HOME/.env`; Vibe documents no subscription login, so check live). **Before copying any login, check live whether the harness rotates refresh tokens**: if the copy refreshes and invalidates the original login, do not copy it; record the finding and stop for that harness. Never copy anything else, never write into the real home.
4. **Configuration guard (fallback and defence in depth).** `config-guard.ts`: before a `read_only` start, inspect the harness configuration that would be loaded (in the controlled home, and, if isolation is not possible for that
   harness, the real one) for settings that auto-approve (Grok `permission_mode`/`always-approve` and allow rules in `~/.grok/config.toml`; Claude Code `permissions.allow` and `defaultMode` in its settings files; Codex `approval_policy` other than
   `untrusted`, and `sandbox_mode` other than `read-only`; Vibe `default_agent` other than `ask`, any `[tools.*] permission = "always"`, and `enable_auto_approve`-style settings, in `$VIBE_HOME/config.toml` and in a project `./.vibe/config.toml` of a trusted folder). If found and not neutralised, **refuse to start** with an error naming the file and the setting. The same function powers `doctor` (WP7).
5. **Hostile-config tests.** For each harness add a test that starts it in `read_only` with a configuration that tries to auto-approve a write and shows either that the write did not happen or that the start was refused with the guard's message.
   With the fake agent this is a scripted peer that would act on a write if asked; the live variant is opt-in per harness.
6. **Spike 007 live pass (opt-in, one per installed harness, small model calls, the owner's own login on a machine you may use).** For each harness record: the exact command and flags that worked; the real credential paths; what a permission request looks like on the wire;
   whether `read_only` blocked a write attempt and a read of `~/.ssh`; whether the user's own config can answer a call before the host sees it (and what the guard did). Update the table above with what is true. If a harness cannot be controlled
   (isolation impossible and the guard cannot detect the unsafe setting, or its login cannot be copied without invalidating the original), **do not ship it**: mark it `moves to v1` in the registry, in STATUS.md and in the ROADMAP note.
7. **The `headless-cli` kind** (new code, not copied; about 200 to 300 lines). A descriptor gives the command and arguments for a turn, how to pass the prompt (`-p`, or stdin), the output mode, a parser for the output into `{ text, sessionId, stopReason, usage? }`, the resume flags (`--resume SESSION_ID`), the exit-code mapping
   (Vibe: 0 finished, 1 and 2 are `HarnessError`, 3 means a limit was hit and is reported as such), the timeout, and `permissionCallbacks: false`. `HarnessSession.prompt` spawns the process in the agent's `cwd`, streams or collects the output, never calls `onPermission`, and cancels with SIGTERM then SIGKILL after a grace period.
   Record real output (fixtures) in the live pass; **the parser must fail loudly** (a `HarnessError` naming the line) when the output changes, because Vibe's output schema is undocumented. Registry rule from [ADR 0020](../../adr/0020-harness-adapter-kinds.md): a harness without `permissionCallbacks` is refused `ask` and `auto`; only `read_only` and `full` exist in v0, so this is checked in `startSession` and tested.
8. **Spike 007 for Vibe, extra questions:** the exact names of the read tools to allowlist; whether the `ask` agent runs read tools without approval and denies the rest; whether a write attempt with `--agent ask` and no allowlist is denied; what the JSON and streaming outputs really look like; whether the working directory is the process `cwd`; whether `--resume` works headless; whether `MISTRAL_API_KEY` in the environment is enough with an empty `VIBE_HOME`; whether any subscription login exists; and whether `vibe-acp` sends permission requests to the client (decides if `ask` mode is possible for Vibe in v1). Record in `docs/research/mistral-vibe.md`.
9. **Docs.** `michel-reuse.md` (provenance table), `THIRD_PARTY_NOTICES.md`, the spike README, `docs/research/mistral-vibe.md` (what was verified).

## Tests

- T-WP4-01 floor: a table of commands and file tools that must be refused (SSH keys, `.aws`, `.env`, the harness's own control files, `rm -rf /`, `curl … | sh`) and of harmless ones that pass.
- T-WP4-02 `decidePermission` table over modes and kinds, including `fetch` denied in `read_only` and allowed in `full`, and the floor winning over `full`.
- T-WP4-03 each harness runs a scripted turn through the fake agent: text out, session id returned, a second turn resumes the session.
- T-WP4-04 permission handler: a denied request returns its reason to the harness and the turn still ends with a reply that says what was refused.
- T-WP4-05 the registry maps `read_only` and `full` to the right flags and sandbox for each harness (assert on the spawn arguments, no process started).
- T-WP4-06 controlled home: the real home is never written; only listed credential files are copied; modes are 0600.
- T-WP4-07 configuration guard: each unsafe setting in the table is detected, the error names file and setting, a clean config passes.
- T-WP4-08 hostile config (fake agent): a write is not performed in `read_only`.
- T-WP4-09 cancellation: `cancel` stops a running turn and `kill` ends the process; no orphan child remains (check the pid).
- T-WP4-13a headless kind with a fake `vibe` script: JSON and streaming parsed from recorded fixtures; each exit code (0, 1, 2, 3) maps to the right result; an unparsable line raises a `HarnessError` naming it; `--resume` is passed on the second turn; cancel sends SIGTERM and then SIGKILL; no orphan remains.
- T-WP4-13b the registry refuses `ask` and `auto` for a harness without `permissionCallbacks` and builds the Vibe `read_only` and `full` arguments exactly as in the table (assert on the spawn arguments and the environment: `VIBE_HOME` set, no `--auto-approve`, `--agent ask`).
- T-WP4-13c auth: for each harness the descriptor reports whether `login`, `api_key` or both are supported; with an API key in the environment and an empty controlled home the fake peer sees the key; with a copied login it sees the credential file at mode 0600.
- T-WP4-10..13 (live, opt-in: `ANYBOT_LIVE_CLAUDE`, `ANYBOT_LIVE_CODEX`, `ANYBOT_LIVE_GROK`, `ANYBOT_LIVE_VIBE`) per harness: reads a file and answers; refuses to create a file in `read_only`; refuses to read a credential file; creates the file in `full`.

## Checks

```bash
pnpm --filter @anybot/harness test && pnpm --filter @anybot/core test
ANYBOT_LIVE_CLAUDE=1 pnpm --filter @anybot/harness test   # per harness you can run; otherwise NOT RUN with reason
grep -rL "Copied from" packages/harness/src packages/core/src/floor   # expect: no output (every copied file has a header)
pnpm check
```

## Achievements

- [ ] Claude Code and Codex each pass T-WP4-10/11 live (or are NOT RUN, which blocks WP8); Grok Build and Vibe pass T-WP4-12 and T-WP4-13 live or are moved to v1 with the reason recorded.
- [ ] In `read_only`, a write and a credential read are refused for every shipped harness, including under a hostile configuration.
- [ ] Every copied file has provenance; `THIRD_PARTY_NOTICES.md` is complete.
- [ ] The per-harness table in this file is corrected to what was observed.
- [ ] Each shipped harness runs on a login, an API key, or both, as its descriptor says, and `doctor` can tell which.
- [ ] The `headless-cli` kind and its parser are tested on recorded fixtures.

## Stop and ask when

A harness cannot be controlled (see step 6); the harness's licence or login terms in use would be violated by running it headless (read Michel's [provider-terms research](https://github.com/Herklos/Michel/blob/main/docs/research/provider-terms.md) and Q19, and report); a copied file has an unclear licence.
