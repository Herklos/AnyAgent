# Mistral Vibe, and headless CLIs versus ACP

Research for [ADR 0020](../adr/0020-harness-adapter-kinds.md). Read 2026-11-07 from Mistral's own pages through a fetch tool; nothing was
installed or run. **Stated** means the page says it; **unverified** means the page does not say, or it was only seen in a summary of the page.

## Sources

- README: [github.com/mistralai/mistral-vibe](https://github.com/mistralai/mistral-vibe) (about 40 of 97 thousand characters read verbatim, the rest through a
  model-made summary: those items are marked [summary]).
- ACP setup: [docs/acp-setup.md](https://github.com/mistralai/mistral-vibe/blob/main/docs/acp-setup.md) (read in full).
- CLI guide: [docs.mistral.ai/vibe/code/cli/work-with-cli](https://docs.mistral.ai/vibe/code/cli/work-with-cli) (read in full).
- No version number appears on any of the three pages.

## What it is

A command-line coding agent from Mistral, **Apache-2.0**. Install: `curl -LsSf https://mistral.ai/vibe/install.sh | bash`, `uv tool install mistral-vibe`, or
`pip install mistral-vibe`. It needs a GIL-enabled Python 3.12 or later and "officially support[s] and target[s] UNIX environments"; it works on Windows.

## Headless mode: `vibe -p`

All stated unless marked.

- Entry: `vibe --prompt "…"` or `-p`; `--prompt-file PATH`; `-p` alone reads stdin.
- `--output text|json|streaming`: text prints the final answer; json is "a JSON array when the run ends"; streaming is "newline-delimited JSON per message".
  **The schema of the JSON and streaming output is not documented**; only the `--output-dir` export (`export.json`: Vibe version, effective config, token usage, cost, steps, stop reason, outcome; `session_id` [summary]) is described.
- Limits: `--max-turns`, `--max-price` (the docs say the cost is "indicative only"), `--max-tokens`, `--time-limit SECONDS`.
- Tool control: `--enabled-tools TOOL` ("disables all others"; exact names, globs or `re:` regular expressions; repeatable) and `--disabled-tools`.
- Agents: `--agent NAME`; `--model ALIAS`; `--system-prompt-file PATH`. Built-in agents: `ask` ("requires approval for tool executions"), **`accept-edits` (the default: "auto-approves file edits only (`write_file`, `edit`)")**,
  `auto-approve` ("auto-approves all tool executions"), `smart-approve` (named, not described), `explore` (a read-only subagent). No `plan` or `read-only` agent is mentioned.
- **Approvals in headless mode, verbatim:** "Nobody can answer an approval prompt, so Vibe denies any tool call that needs one." `--auto-approve` (alias `--yolo`) approves everything; an admin setting `enable_auto_approve = false` makes Vibe ignore it.
- Sessions: `--continue` / `-c`, `--resume SESSION_ID` (partial ids allowed); "In programmatic mode, combine `-p` with `--continue` or `--resume SESSION_ID`"; session logging must stay on.
- Trust: `--trust` grants temporary trust for one invocation; project configuration (`./.vibe/config.toml`) loads only for trusted folders (kept in `~/.vibe/trusted_folders.toml`).
- Exit codes: 0 finished; 1 could not start (invalid flag or config); 2 the model API or the runtime failed; 3 stopped before finishing (a limit, a stop, or the model declined).
- The working-directory flag for headless runs is **unverified**; the docs say to run from the project root, which a spawned process can do with `cwd`.

## Configuration, and where it can auto-approve

- TOML at `./.vibe/config.toml` (trusted folders only) then `~/.vibe/config.toml`; **`VIBE_HOME` replaces `~/.vibe/`** (stated). That makes a controlled home possible without touching the real one.
- Per tool: `[tools.<name>]` with `permission = "always"` or `"ask"` [summary]; `default_agent = "auto-approve"` in `config.toml`, which "applies to programmatic runs too" (README). So a user's own configuration **can** approve calls
  without the host, exactly the failure Michel's audit records for Grok and Claude Code.

## ACP: `vibe-acp`

A separate command that speaks the Agent Client Protocol for editors: documented for Zed, JetBrains AI Assistant 2025.3+, Xcode and Neovim (avante.nvim). **Whether it asks the client for permission on a tool call, supports session resume and cancel,
is not stated** on the ACP page. An experimental, hidden `vibe run-server` and `--agent-socket` exist (JSON-RPC over stdio; not on Windows); they are not a basis to build on.

## Authentication

- Env var `MISTRAL_API_KEY`; `vibe --setup` or the first run saves the key to `~/.vibe/.env` (under `VIBE_HOME` if set).
- A browser sign-in exists in the setup wizard [summary] but the credential stays a Mistral API key. **A Le Chat or other subscription login as a substitute for an API key is not stated.** For [Q19](../OPEN-QUESTIONS.md) this
  means Vibe may support only the API-key route; a live check decides.

## Headless CLI or ACP? A comparison, by harness

| Harness | Headless entry | ACP or protocol entry | Per-call permission callback to the host |
| --- | --- | --- | --- |
| Claude Code | `claude -p` (the owner's example; flags such as `--allowedTools` and `--output-format` are from my knowledge of the CLI, **not checked this session**) | Michel uses `@agentclientprotocol/claude-agent-acp` | yes over ACP |
| Codex | not checked this session | `codex app-server` (Michel's adapter) | yes |
| Grok Build | `-p` (xAI's page: "Headless mode (`-p`) allows easily running agents inside scripts and automations") | `grok agent stdio` ("full ACP support", xAI) | per Michel, over ACP; unverified live (Michel audit G172) |
| Mistral Vibe | `vibe -p`, documented above | `vibe-acp`, capabilities not documented | **unknown over ACP; none in headless mode** (denied unless pre-approved) |

What a headless run gives and costs:

| | Headless (`-p`) | ACP or app-server |
| --- | --- | --- |
| Process model | spawn, wait, read the output and the exit code | a long-lived JSON-RPC session |
| Read-only | a static policy given as flags: an allowlist, an `ask` agent whose approvals are denied | the same, plus a host decision per call |
| `ask` and `auto` modes, approvals through Anytype, a decision model | **not possible**: nobody can answer a prompt | possible: the host answers each permission request |
| Failure signals | exit codes | protocol errors |
| Output | one schema per CLI, often undocumented (Vibe's is) | one protocol |
| Cancellation | signal the process | a protocol call, then close |
| Session continuity | the CLI's own resume flag | the protocol's session calls |

## Conclusions for anybot

1. **v0 can use headless CLIs.** v0 has only `read_only` and `full`; neither needs a per-call decision by the host. A static policy by flags fits, and for Vibe it is stronger than an ACP deny: `--enabled-tools` is a hard allowlist and
   the `ask` agent denies the rest.
2. **v1 cannot rely on headless alone.** Approvals through Anytype (v1) and the decision model (v3) need a permission callback, so a harness used for `ask` or `auto` must offer one (ACP, an app-server, or a CLI feature such as an approval-prompt hook).
   A headless-only harness is limited to `read_only` and `full`.
3. **The default agent is the trap.** Vibe's default `accept-edits` auto-approves file edits, so a bare `vibe -p` is not read-only. Every `read_only` run must name its agent and tools.
4. **A controlled home is easy for Vibe** (`VIBE_HOME`), which is also the answer to a user configuration that sets `default_agent = "auto-approve"`.
5. Open until a live run: the exact read-only tool names, the real JSON and streaming output, whether the `ask` agent lets read tools run without approval, whether `--workdir` exists, and whether a subscription login works.
