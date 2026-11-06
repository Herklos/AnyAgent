# ADR 0010: Reuse Michel's harness adapters; own the agent workflow (no temporal-agent-harness)

- Status: **proposed** (the owner questioned vendoring temporal-agent-harness; this ADR answers it, awaiting confirmation)
- Date: 2026-11-06

## Context

Michel ([Herklos/Michel](https://github.com/Herklos/Michel), Apache-2.0) has two layers anyagent could reuse:

1. **Harness adapters** (`packages/harness/adapters`, 2,890 lines of TypeScript): an ACP client over a child process,
   native Codex app-server, an OpenAI-compatible tool loop with MCP bridging, a registry of harness descriptors, and a
   scripted fake agent for tests. Plain Node code, no workflow code. `@michel/core` is listed in its `package.json` but
   nothing in `src/` imports it.
2. **The agent workflow** (`packages/temporal/workflows/src/agent.ts`, 145 lines) built on `defineAgent` from
   `@temporalio/agent-harness`, which Michel vendors as a git submodule of the fork `Herklos/temporal-agent-harness`
   (upstream `temporal-community/temporal-agent-harness`, MIT, published on npm, README: "Experimental. APIs change
   between releases.").

Michel's own notes show the cost of the second: "The agent workflow cannot [continue as new], because that loop lives in
the harness fork (`vendor/`, do not edit it). The hub rotates the run before 1,500 accepted updates" and "never replaces
a run with a turn in flight" (`packages/temporal/workflows/AGENTS.md`). anyagent's agent is a single workflow meant to
live forever and to receive signals from chat, objects, cron and webhooks; it needs to own its loop and its
continue-as-new. What the harness adds besides the loop (a streaming console, typed UI, approval UI) is replaced by
Anytype in anyagent.

## Decision

1. **Reuse the adapters.** Copy `packages/harness/adapters` into `packages/harness` with a provenance note (source
   commit, licence), drop the unused `@michel/core` dependency, keep the `HarnessSession` interface, registry and fake
   agent. Track upstream changes by hand until both projects share a published package (open question Q9).
2. **Reuse pure decisions.** Copy `approval.ts` (`preDecision`, 87 lines) with its table tests.
3. **Do not vendor or depend on temporal-agent-harness.** Write the agent workflow directly on `@temporalio/workflow`
   ([specs/agent-workflow.md](../specs/agent-workflow.md)): signals, updates, coalescing, the approval wait and
   `continueAsNew` are about 300 lines anyagent controls and can test with Temporal's time-skipping test environment.
4. **Reuse ideas, not code**, from Michel ADRs 0014 (inbox batching and delivery modes), 0019 (verified work), 0022
   (fresh sessions per task), 0026 (operation receipts) and 0028 (connector output discipline).

## Consequences

- No submodule and no fork to keep in step. The workflow can `continueAsNew` on its own schedule.
- anyagent rebuilds what `defineAgent` gave Michel: mid-turn policies and the approval gate. Both are small and are
  specified in the workflow spec.
- Two copies of the adapters exist until a shared package is published.

## Extension points

- `HarnessSession` interface and the registry: a new harness is a descriptor or a session class.

## Not generalised

- No streaming of token deltas to a UI in v0 (Anytype receives the final reply; edits to a "working…" message are a
  possible later improvement).
