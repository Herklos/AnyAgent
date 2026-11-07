# ADR 0020: Harness adapter kinds: ACP, app-server, and headless CLI

- Status: accepted (owner, 2026-11-07: add Mistral Vibe "the same way as claude, codex and grok", and "can't we use directly their CLI as headless like `claude -p`?"). The kind used for each harness is confirmed by spike 007.
- Date: 2026-11-07

## Context

Michel's adapters drive Claude Code and Grok Build over ACP and Codex over its app-server ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)). The owner wants Mistral Vibe supported in v0 as well, and asks whether a CLI can simply be run
headless like `claude -p`. [research/mistral-vibe.md](../research/mistral-vibe.md) has the facts: Vibe has a documented headless mode (`vibe -p`, JSON output, exit codes, a tool allowlist, denial of anything that needs approval) and an ACP
server (`vibe-acp`) whose permission and session behaviour is not documented. In headless mode "nobody can answer an approval prompt".

## Decision

1. **Three adapter kinds in the registry:** `acp` (an ACP agent over stdio: Claude Code, Grok Build), `app-server` (Codex), and `headless-cli` (spawn the CLI per turn, read its output and exit code). A descriptor declares its kind and
   its capabilities: `permissionCallbacks` (can the host answer each permission request), `sessionResume`, `streaming`, and `auth` (`login`, `api_key`, or both).
2. **Modes follow capabilities.** `read_only` and `full` work for every kind: a static policy given as flags and configuration. `ask` and `auto` (approvals through Anytype, the decision model; v1 and v3) require
   `permissionCallbacks`. A harness without it is refused those modes with a clear message (at `agent create` and in `doctor`).
3. **Mistral Vibe ships in v0 as `headless-cli`**, since its headless behaviour is documented and its ACP behaviour is not. `read_only` runs `vibe -p` with an explicit `ask` agent (never the default `accept-edits`), an explicit `--enabled-tools`
   allowlist of read tools, no `--auto-approve`, no `--trust`, limits (`--max-turns`, `--time-limit`), and a controlled `VIBE_HOME`; `full` uses the `auto-approve` agent. `vibe-acp` is evaluated in v1 for `ask` mode.
   Like Grok Build, Vibe ships in v0 **only if its live check passes**.
4. **Any harness may use the other kind** if spike 007 shows it works better (for example `claude -p` as a fallback). The choice per harness is data in the registry, not code in the node.
5. **Headless output is parsed through a per-descriptor parser backed by recorded fixtures** and fails loudly (a `HarnessError` naming the unparsed line) when the output changes; the schema of some CLIs is undocumented.
6. **`read_only` rules are unchanged:** the floor first, a controlled home, a configuration guard that refuses to start on an auto-approving setting, and the harness's own read-only mode where it has one
   ([ADR 0013](0013-agent-permissions-over-the-org.md), [WP4](../roadmap/v0/WP4-harness-and-permissions.md)).
7. **Authentication ([Q19](../OPEN-QUESTIONS.md), settled: both).** Each harness can run on a subscription login or an API key where the harness offers both. The node never signs a harness in: the person does that beforehand. A descriptor lists the files that
   carry a login (copied into the controlled home) and the environment variable for the key. `doctor` says which is in use. Where a harness has no documented subscription route (Vibe: only an API key is documented), say so.

## Consequences

- About 3 to 4 more days in WP4 for the `headless-cli` kind and its parser, which Claude Code, Codex or Grok can also use as a fallback.
- Vibe cannot use `ask` or `auto` until `vibe-acp` (or another callback) is verified.
- A copied login can be invalidated if the harness rotates refresh tokens (the copy refreshes and the original stops working); spike 007 checks this per harness before a login is copied.

## Extension points

- A new harness is a registry entry choosing a kind and giving its flags, credential paths and parser; a fourth kind (for example an SDK) needs only the `HarnessSession` interface.
- Capabilities (`permissionCallbacks`, `sessionResume`, `streaming`, `auth`) gate features, never the harness's name.

## Not generalised

- No automatic discovery of arbitrary CLIs, and no scraping of a terminal UI or a pseudo-terminal, ever.
- No mixing of kinds inside one turn.
