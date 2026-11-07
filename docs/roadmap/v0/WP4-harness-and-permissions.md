# WP4: harness adapters, permission rules, and a `read_only` that holds

**Goal.** One interface runs a turn on Claude Code, Codex or Grok Build, and in `read_only` mode nothing is written or executed, **even when the harness's own configuration would approve a
call by itself**, and credential files are never read in any mode. Includes **spike 007**.

**Depends on:** WP0 (independent of WP1 to WP3). **Unblocks:** WP6.

## Scope

In: copy Michel's adapters for the three harnesses with provenance; the fake agent for tests; the permission rules and the floor; per-harness `read_only` mapping; a controlled home and a configuration guard;
live checks. Out: the OpenAI-compatible adapter and its MCP bridge, OpenCode, `ask` and `auto` modes, MCP servers for agents, approvals through Anytype, computer use.

## Read first

[ROADMAP v0](../../ROADMAP.md) (harness bullet), [ADR 0010](../../adr/0010-reuse-michel-adapters-and-the-npm-harness.md) (decisions 1 and 2: copy adapters and `approval.ts`), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md),
[research/michel-reuse.md](../../research/michel-reuse.md), and in `Herklos/Michel@402865d`: `packages/harness/adapters/AGENTS.md`, `src/{types,jsonrpc-child,acp,codex,registry,fake-agent,fake-agent-main,index}.ts`,
`docs/research/sandbox-spike.md` (the per-harness read-only table), `docs/AUDIT.md` G172, G176, G247, `packages/core/src/{command-floor,command-policy}.ts` with their tests,
`packages/temporal/workflows/src/approval.ts` and `contracts.ts` (`READ_ONLY_KINDS`).

## Files

Create: `packages/harness/src/{types.ts,jsonrpc-child.ts,acp.ts,codex.ts,registry.ts,fake-agent.ts,fake-agent-main.ts,home.ts,config-guard.ts,index.ts}`, `packages/harness/test/*.test.ts`,
`packages/core/src/floor/{command-floor.ts,command-policy.ts}` and their tests, `packages/core/src/permission.ts` and its test, `THIRD_PARTY_NOTICES.md`, `spikes/007-harness-readonly/README.md`.
Change: `docs/research/michel-reuse.md` (what was copied, at which commit, what was changed), `docs/SPIKES.md` (007).
Must not change: the OpenAI adapter files are **not** copied; do not copy `opencode` code or its dependency.

## Provenance rule

Every copied file starts with a header: source repository, path, commit (`402865d`), licence (Apache-2.0, same as anyagent), and a one-line list of changes. `THIRD_PARTY_NOTICES.md` lists them. Copy, then change
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

Michel has run **none of Codex's mapping and Grok for real** (audit G176, G172). Treat the table as a hypothesis until spike 007 confirms it live.

## Steps

1. **Copy and make it build.** Bring over the listed adapter files and the floor with provenance headers, drop the other harnesses from `registry.ts`, make the existing fake-agent tests pass.
2. **Interface for the node.** Keep `HarnessSession` (`prompt(input, sink, onPermission)`, `cancel`, `close`, `kill`) and `SessionInit`. Add `startSession(harnessId, init)` in the registry that maps `approvalMode` to the table above.
3. **Controlled home.** `home.ts`: for each agent a directory `<state.dir>/agents/<spaceId>/<agentId>/home`. The harness is started with `HOME` (and the harness's own config-dir variables) pointing there. A descriptor lists
   `credentialPaths`: the home-relative files that carry the login (for example Claude's credentials file, Codex's `auth.json`, Grok's token file; find the real names live). The node copies those, read-only, mode 0600, from the real home;
   it writes a minimal config of its own for the mode. API keys can instead be passed through the environment (Q19). Never copy anything else, never write into the real home.
4. **Configuration guard (fallback and defence in depth).** `config-guard.ts`: before a `read_only` start, inspect the harness configuration that would be loaded (in the controlled home, and, if isolation is not possible for that
   harness, the real one) for settings that auto-approve (Grok `permission_mode`/`always-approve` and allow rules in `~/.grok/config.toml`; Claude Code `permissions.allow` and `defaultMode` in its settings files; Codex `approval_policy` other than
   `untrusted`, and `sandbox_mode` other than `read-only`). If found and not neutralised, **refuse to start** with an error naming the file and the setting. The same function powers `doctor` (WP7).
5. **Hostile-config tests.** For each harness add a test that starts it in `read_only` with a configuration that tries to auto-approve a write and shows either that the write did not happen or that the start was refused with the guard's message.
   With the fake agent this is a scripted peer that would act on a write if asked; the live variant is opt-in per harness.
6. **Spike 007 live pass (opt-in, one per installed harness, small model calls, the owner's own login on a machine you may use).** For each harness record: the exact command and flags that worked; the real credential paths; what a permission request looks like on the wire;
   whether `read_only` blocked a write attempt and a read of `~/.ssh`; whether the user's own config can answer a call before the host sees it (and what the guard did). Update the table above with what is true. If a harness cannot be controlled
   (isolation impossible and the guard cannot detect the unsafe setting), **do not ship it**: mark it `moves to v1` in the registry, in STATUS.md and in the ROADMAP note.
7. **Docs.** `michel-reuse.md` (provenance table), `THIRD_PARTY_NOTICES.md`, the spike README.

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
- T-WP4-10..12 (live, opt-in: `ANYAGENT_LIVE_CLAUDE`, `ANYAGENT_LIVE_CODEX`, `ANYAGENT_LIVE_GROK`) per harness: reads a file and answers; refuses to create a file in `read_only`; refuses to read a credential file; creates the file in `full`.

## Checks

```bash
pnpm --filter @anyagent/harness test && pnpm --filter @anyagent/core test
ANYAGENT_LIVE_CLAUDE=1 pnpm --filter @anyagent/harness test   # per harness you can run; otherwise NOT RUN with reason
grep -rL "Copied from" packages/harness/src packages/core/src/floor   # expect: no output (every copied file has a header)
pnpm check
```

## Achievements

- [ ] Claude Code and Codex each pass T-WP4-10/11 live (or are NOT RUN, which blocks WP8); Grok Build passes T-WP4-12 live or is moved to v1 with the reason recorded.
- [ ] In `read_only`, a write and a credential read are refused for every shipped harness, including under a hostile configuration.
- [ ] Every copied file has provenance; `THIRD_PARTY_NOTICES.md` is complete.
- [ ] The per-harness table in this file is corrected to what was observed.

## Stop and ask when

A harness cannot be controlled (see step 6); the harness's licence or login terms in use would be violated by running it headless (read Michel's [provider-terms research](https://github.com/Herklos/Michel/blob/main/docs/research/provider-terms.md) and Q19, and report); a copied file has an unclear licence.
