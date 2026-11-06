# What anyagent reuses from Michel

Source: [Herklos/Michel](https://github.com/Herklos/Michel) at `402865d` (2026-11-06), Apache-2.0, the same licence as
anyagent. Decision: [ADR 0010](../adr/0010-reuse-michel-adapters-and-the-npm-harness.md) (accepted).

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
| `packages/hub`, `packages/storage`, `packages/starfish`, `apps/server`, `apps/app` | Replaced by Anytype (storage, chat, console). |
| `MichelChannel` (sequencer and router of a channel) | Replaced by the event gateway and Anytype chat ordering. |

## Reused as a dependency, not copied

| Michel path | anyagent |
| --- | --- |
| `vendor/temporal-agent-harness` (a submodule pinning upstream `ce68611`; the fork has no patches of its own) | `@temporalio/agent-harness` from npm, pinned with the Temporal SDK it is locked to ([research](temporal-agent-harness.md)) |
| `MichelAgent` on `defineAgent` (`packages/temporal/workflows/src/agent.ts`) | The pattern: handlers, a custom permission update, policy from the approval mode, a rotation query. anyagent's `AnyAgent` follows it ([spec](../specs/agent-workflow.md)) |
| Hub rotation of agent runs before 1,500 updates, never with a turn in flight | Done by anyagent's gateway ([ADR 0011](../adr/0011-event-gateway.md)) |

## Michel's plans anyagent follows

| Michel source | Plan | anyagent |
| --- | --- | --- |
| `docs/PLAN.md` line 429; `docs/adr/0003-harness-adapters.md` line 12 | `openai_compatible` providers incl. llama.cpp, model discovery | [ADR 0014](../adr/0014-model-endpoints-local-and-cloud.md) |
| `docs/PLAN.md` lines 313 and 574 | `auto` approvals by a pluggable evaluator using any configured model; nothing fails open | [ADR 0015](../adr/0015-decision-model-for-approvals.md) |
| `docs/PLAN.md` §15, line 97; ADR 0012 | Computer-use ladder, Linux containers first, through `vercel-labs/agent-desktop` | [ADR 0016](../adr/0016-computer-use-with-cua.md): the same seam, cua first (Michel does not mention cua at `402865d`) |

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
