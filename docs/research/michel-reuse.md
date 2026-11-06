# What anyagent reuses from Michel

Source: [Herklos/Michel](https://github.com/Herklos/Michel) at `402865d` (2026-11-06), Apache-2.0, the same licence as
anyagent. Decision: [ADR 0010](../adr/0010-reuse-michel-adapters-own-the-workflow.md) (proposed).

## Code to copy

| Michel path | Lines | What it is | Coupling | Plan |
| --- | --- | --- | --- | --- |
| `packages/harness/adapters/src/types.ts` | 121 | `HarnessSession`, `SessionInit`, `AdapterEvent`, `PermissionRequest/Decision` | none | copy |
| `…/src/registry.ts` | 174 | Harness descriptors (`claude-code`, `codex`, `opencode`, `grok`, `openai`, `fake`, `custom`), `controlPaths` | none | copy; descriptors become data |
| `…/src/jsonrpc-child.ts` | 177 | JSON-RPC over a child process's stdio | none | copy |
| `…/src/acp.ts` | 344 | ACP client (Claude Code via `@agentclientprotocol/claude-agent-acp`, OpenCode, any ACP agent) | `jsonrpc-child` | copy |
| `…/src/codex.ts` | 394 | Native Codex app-server, approval recovery, sandbox mapping | `jsonrpc-child`, `registry` | copy |
| `…/src/openai/{client,session,tools,mcp}.ts` | 1,412 | OpenAI-compatible tool loop, built-in tools, MCP bridge | `@modelcontextprotocol/sdk` | copy |
| `…/src/fake-agent.ts`, `fake-agent-main.ts` | 260 | Scripted fake harness for tests | none | copy |
| `packages/temporal/workflows/src/approval.ts` | 87 | `preDecision`: approval modes, hard and soft floors, allow-lists | none (pure) | copy with its tests |

Total ~2,980 lines. `@michel/core` is a declared dependency of the adapters package but nothing in `src/` imports it
(checked with `grep -rn "@michel" packages/harness/adapters/src`: one hit, an error string). Runtime dependencies:
`@agentclientprotocol/claude-agent-acp` 0.99.1, `@modelcontextprotocol/sdk` 1.32.2, `opencode-ai` 1.19.5.

Known caveats carried over (from `packages/harness/adapters/AGENTS.md`): Codex sandbox names and config keys are "not
verified on a real Codex (audit G176)"; live tests need opt-in variables and real logins.

## Code not to reuse

| Michel path | Why not |
| --- | --- |
| `vendor/temporal-agent-harness` (submodule of `Herklos/temporal-agent-harness`) and `MichelAgent` on `defineAgent` | The agent loop lives in the harness, so the workflow cannot `continueAsNew` ("The agent workflow cannot, because that loop lives in the harness fork", `packages/temporal/workflows/AGENTS.md`). anyagent owns a ~300-line workflow instead. The harness itself is MIT and on npm as `@temporalio/agent-harness`, marked "Experimental. APIs change between releases." |
| `packages/hub`, `packages/storage`, `packages/starfish`, `apps/server`, `apps/app` | Replaced by Anytype (storage, chat, console). |
| `MichelChannel` (sequencer and router of a channel) | Replaced by the event gateway and Anytype chat ordering. |

## Ideas to reuse (no code)

| Michel ADR | Idea | Where in anyagent |
| --- | --- | --- |
| 0014 Agent messaging and delivery | Inbox with cursors, coalescing into one turn, delivery modes, receipts 👀 ⏳ ✅, a messaging-conventions skill | [agent-workflow.md](../specs/agent-workflow.md) main loop |
| 0018 Harness profiles | Primary + ordered fallbacks, never a sign-in the person did not choose, per-token billing confirmation | later: `aa_harness_profile` |
| 0019 Verified work and landing | Frozen criterion, gate at an exact commit, a different agent verifies | `aa_task.aa_criterion`, `aa_reviewer`; full gates later |
| 0022 Fresh sessions | Session scope `agent` or `task`, drop at a context fraction | `aa_agent.aa_session_scope` |
| 0025 Generic by default | No instance names in logic, registries over `if`s, extension points in every ADR | [AGENTS.md](../../AGENTS.md) rule 6 |
| 0026 Durable operations | Operation receipts (key + digest), loops with completion contracts | `aa_op_key` writes; loops later |
| 0028 Chat connectors | Output discipline: only visible text leaves, replies coalesced, approvals never from text | egress rules in [ARCHITECTURE.md](../ARCHITECTURE.md) §3.3 |

## Open

- Share instead of copy? A published `@herklos/harness-adapters` package used by both Michel and anyagent would avoid
  drift. Q9.
