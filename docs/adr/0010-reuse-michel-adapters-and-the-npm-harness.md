# ADR 0010: Reuse Michel's harness adapters; build the agent workflow on temporal-agent-harness from npm

- Status: accepted. **Decisions 3 and 5 are replaced by [ADR 0019](0019-own-workflow-core-behind-a-seam.md)** (accepted 2026-11-07): our own small core behind a seam, deciding on the harness at v1. (owner, 2026-11-06). Supersedes the proposed version ("own the workflow, no temporal-agent-harness").
  The owner: "I didn't say not to depend on temporal-agent-harness but just not vendor it if possible but npm install it."
- Date: 2026-11-06

## Context

Michel ([Herklos/Michel](https://github.com/Herklos/Michel), Apache-2.0) has two layers anybot can reuse:

1. **Harness adapters** (`packages/harness/adapters`, 2,890 lines): ACP over a child process, native Codex app-server,
   an OpenAI-compatible tool loop with an MCP bridge, a registry, and a scripted fake agent. Plain Node code.
2. **The agent workflow**, built with `defineAgent` from `@temporalio/agent-harness`, which Michel vendors as a git
   submodule.

Checked on 2026-11-06 ([research/temporal-agent-harness.md](../research/temporal-agent-harness.md)):

- The harness is MIT and **on npm** (`@temporalio/agent-harness`, `-worker` and `-client` 0.3.1, published 2026-11-05).
  Michel's submodule pins an upstream commit and its fork has no patches of its own, so nothing requires vendoring.
- 0.3.1 **imports only with the Temporal SDK pinned to 1.24.0**. With 1.25.0, a deep import into `@temporalio/common`
  fails to resolve.
- The harness gives a turn queue with mid-turn policies, a tool-approval gate, **auto mode with a pluggable evaluator
  that races a person** (the basis of [ADR 0015](0015-decision-model-for-approvals.md)), status queries, idle close and
  subagents.
- It has **no continue-as-new** in TypeScript. Temporal allows about 2,000 updates per workflow history, so a run must be
  replaced from outside, between turns, as Michel's hub does.
- It is marked experimental: "APIs change between releases. Pin versions and upgrade deliberately."

## Decision

1. **Reuse the adapters.** Copy `packages/harness/adapters` into `packages/harness` with a provenance note (source
   commit, licence), drop the unused `@michel/core` dependency, and keep the `HarnessSession` interface, registry and fake
   agent. A shared published package remains open (Q9).
2. **Reuse pure decisions.** Copy `approval.ts` (`preDecision`) with its table tests.
3. **Depend on the harness from npm.** Install `@temporalio/agent-harness` (workflow bundle) and
   `@temporalio/agent-harness-worker` (nodes), and the client package where needed. Pin all of them to an exact version,
   starting at 0.3.1, and pin every `@temporalio/*` SDK package to the version that release is locked to (1.24.0). Don't
   use a submodule or a fork. Upgrade deliberately, in a commit that runs the workflow tests.
4. **When the harness needs a change**, propose it upstream first. While it is pending, carry it as a `pnpm patch` file
   in this repository. Vendor only as a last resort, and record that in this ADR.
5. **The agent workflow is `defineAgent`**, shaped like Michel's `MichelAgent`: one handler per event kind, a custom
   `permission` update and a `claim` update, and the policy set from the agent's approval mode. The contract is
   [specs/agent-workflow.md](../specs/agent-workflow.md).
6. **Rotation, not continue-as-new.** The gateway, which starts every run ([ADR 0011](0011-event-gateway.md)), replaces
   a run when Temporal suggests continue-as-new or the history nears the update limit. It does this only when the run is
   idle (no turn, nothing queued), by closing it; the next event starts a fresh run under the same workflow id. If
   upstream adds continue-as-new, rotation is deleted.
7. **Reuse ideas, not code**, from Michel ADRs 0014, 0019, 0022, 0026 and 0028 ([research](../research/michel-reuse.md)).

## Consequences

- No submodule and no fork. Upstream fixes arrive by bumping a version, and Michel and anybot run the same engine.
- About 300 lines of workflow code anybot would otherwise own are not written: the queue, the approval gate and auto
  mode.
- anybot is exposed to an experimental 0.x API. Exact pins and the workflow tests (spike 006) contain that.
- Messages enter through an update, so the gateway uses update-with-start, not signal-with-start
  ([ADR 0011](0011-event-gateway.md)).
- 0.3.1 has no coalescing of queued messages into one turn. Each queued delivery is its own turn (see the workflow spec).

## Extension points

- `HarnessSession` interface and the registry: a new harness is a descriptor or a session class.
- Handler kinds in the agent workflow: a new event kind is a handler entry.
- The auto-mode evaluator is pluggable ([ADR 0015](0015-decision-model-for-approvals.md)).
- The harness's own model integrations (OpenAI Agents, Gemini) could become additional harnesses later.

## Not generalised

- The harness's console and UI are not used; Anytype is the UI.
- No token streaming to people in v0 (Q13).
