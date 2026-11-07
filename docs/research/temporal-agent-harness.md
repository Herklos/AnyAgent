# temporal-agent-harness from npm, checked

What anybot would depend on, and what was checked on 2026-11-06. Decision: [ADR 0010](../adr/0010-reuse-michel-adapters-and-the-npm-harness.md).

## Where it comes from

- Upstream: [`temporal-community/temporal-agent-harness`](https://github.com/temporal-community/temporal-agent-harness),
  MIT, read at `9eaf026` (2026-11-06). README, line 9: "**Experimental.** APIs change between releases. Pin versions and
  upgrade deliberately."
- The TypeScript packages were made publishable on 2026-10-29 (upstream #244, `15f9db2`) and are on npm:

  | Package | Latest | Published | Role |
  | --- | --- | --- | --- |
  | `@temporalio/agent-harness` | 0.3.1 | 2026-11-05 (first 2026-11-02) | Workflow-safe authoring: `defineAgent`, `handler`, `MidTurn`, `ToolApprovalPolicy`, auto mode |
  | `@temporalio/agent-harness-worker` | 0.3.1 | 2026-11-05 | Worker-side plugin and activities |
  | `@temporalio/agent-harness-client` | 0.3.1 | 2026-11-05 | Client and protocol types |

  Source: `npm view <package> version time` (2026-11-06).
- **Michel's vendored copy carries no patches.** Michel's submodule `vendor/temporal-agent-harness` pins `ce68611`
  (2026-10-27), which is an upstream commit, and the fork `Herklos/temporal-agent-harness` has no commit that is not on
  upstream `main` (`git log up/main..origin/main` is empty). Michel pinned it before the packages were published.

## Install check

Run in a scratch directory with Node 22.23.4:

1. `npm install @temporalio/agent-harness@0.3.1 @temporalio/agent-harness-worker@0.3.1` resolves the Temporal SDK to
   **1.25.0** (the harness asks for `^1.24.0`). `import('@temporalio/agent-harness')` then **fails**:
   `ERR_MODULE_NOT_FOUND … @temporalio/common/lib/time.js.js`. Cause: the harness imports
   `@temporalio/common/lib/time.js` (`typescript/packages/core/src/harness/agent-workflow.ts`, line 28, still present at
   `9eaf026`), and `@temporalio/common` 1.25.0 (published 2026-10-27) maps `"./lib/*"` to `"./lib/*.js"` in its
   `exports`. Upstream does not see this because its lockfile pins 1.24.0.
2. With every `@temporalio/*` SDK package pinned to **1.24.0**, both packages import. Core exports `defineAgent`,
   `handler`, `MidTurn`, `ToolApprovalPolicy` and `ToolApprovalDenied`, and worker exports 22 names. `node_modules` is
   about 270 MB, mostly optional AI SDK peers that anybot does not install.

So anybot pins the harness **and** the Temporal SDK version the harness release is locked to, until upstream fixes the
deep import (open question Q14).

## The API anybot builds on (0.3.1)

Sources are upstream files under `typescript/packages/core/src/harness/`:

- **Messages enter through one update.** The runner registers a message update, a tool-approval update, a
  callback-result update, a status query, an interface query and a close signal (`agent-workflow.ts`, lines 151–160 and
  219–230). A message names a declared handler and carries its input. The validator rejects every message once the
  agent is closed (`AgentClosed`, lines 555–564).
- **Handlers** are declared with `handler({description, input, output, midTurn, modelCallable})` (`agent.ts`, line 50).
  `midTurn` is `enqueue`, `reject` (the default) or `accept` (`agent-protocol/agent-interface.ts`, line 19). A
  handler's reply carries `turn_id`, `message_id` and a disposition (`agent-interface.ts`, `AgentMessageReply`).
- **Approvals**: `ToolApprovalPolicy` (always ask, allow inherently safe, skip all, allow-lists) plus a tool-approval
  decision `{tool_id, approved, reason, remember}` (`agent-interface.ts`, `ToolApprovalDecisionSchema`).
- **Auto mode**: named criteria sets with `approve_when`, `deny_when`, `escalate_when`, `min_confidence` and
  `escalate_if_irreversible_above` (`agent-interface.ts`, lines 176–181), judged by a pluggable `AutoModeEvaluator`
  returning `approve`, `deny` or `escalate`. "Async on purpose: the gate races it against a human and cancels the
  loser" (`agent-interface.ts`, line 285). Upstream ships one evaluator for its Jev service (`ai-sdks/jev/evaluator.ts`);
  `defineAgent` accepts any (`agent.ts`, `autoModeEvaluator`).
- **Lifecycle**: `setup` runs "before the first message, and again at the start of each run after a continue-as-new";
  `teardown` runs after close drains (`agent.ts`, line 378). Idle close: `closeAfterIdleDefault`.
- **No continue-as-new.** Nothing in the TypeScript core calls it at `9eaf026` (only the comment above). Michel's notes:
  "Temporal allows about 2,000 updates per workflow history … The hub rotates the run before 1,500 accepted updates, in
  a gap between turns … It never replaces a run with a turn in flight, because terminating a run does not cancel the
  harness turn on the node" (Michel `packages/temporal/workflows/AGENTS.md`, line 28).
- **Mid-turn steering** ("the next tool result carries the user's message", upstream #283) landed after 0.3.1 and is not
  in the 0.3.1 package (no `steering.js` in `dist/`).

## How Michel uses it

`MichelAgent = defineAgent({...})` with one `deliver` handler (`MidTurn.ENQUEUE`), the approval policy chosen from the
agent's mode (`read_only` → allow inherently safe, `full` → skip all), plus a custom permission update and a rotation
query registered with `setHandler` inside `create` (Michel `packages/temporal/workflows/src/agent.ts`, lines 1–60).
anybot follows the same shape.

## Temporal client features used by the gateway

From `@temporalio/client` 1.24.0 type definitions: `startUpdateWithStart` / `executeUpdateWithStart`
(`lib/workflow-client.d.ts`, lines 415 and 440; `workflowIdConflictPolicy` is required), `waitForStage: 'ACCEPTED'`
(same file, line 94), `updateId` (`lib/workflow-options.d.ts`, line 71) and `apiKey` on the connection
(`lib/connection.d.ts`, line 100, for Temporal Cloud). Not checked yet: the minimum Temporal server version that supports
update-with-start, and that a repeated `updateId` is deduplicated within a run (spike 004).

## Update 2026-11-07: `0.4.0`

`@temporalio/agent-harness` **0.4.0** was published on 2026-11-07 (02:21 UTC), the sixth release in five days. Read from the
registry metadata and the tarball (read-only; not installed or run):

- Dependency ranges are unchanged (`@temporalio/*` `^1.24.0`).
- The deep import `@temporalio/common/lib/time.js` is **still present** (`dist/src/harness/agent-workflow.js`, line 10), so it
  still fails on SDK 1.25 and the exact pin to 1.24.0 stays.
- There is still **no continue-as-new** anywhere in the package.
- **Steering is now exported** (`ClaimedSteering`), so the earlier note that it is missing applies to `0.3.1` only.

Whether to depend on it at all is analysed in [harness-vs-own-vs-framework.md](harness-vs-own-vs-framework.md) and decided
in [ADR 0019](../adr/0019-own-workflow-core-behind-a-seam.md) (own core now, the harness reconsidered at v1).
