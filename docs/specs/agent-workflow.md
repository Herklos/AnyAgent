# The agent workflow (v0)

> **Decided:** [ADR 0019](../adr/0019-own-workflow-core-behind-a-seam.md) (accepted) has v0 implement this behaviour with
> our own small `AgentCore` instead of `defineAgent`, and decides on the harness at v1. The behaviour below is what
> WP6 built; names from the earlier harness draft (`defineAgent`, MidTurn) are historical.

One workflow per `aa_agent` ([ADR 0003](../adr/0003-one-shared-temporal-one-workflow-per-agent.md)). Workflow code is
deterministic: no clock, randomness or I/O. Everything that touches the world is an activity on the agent's node queue.

- Workflow type: `AnyBot` (`packages/workflows/src/anybot-workflow.ts`), composed with `createOwnCore()`
- Workflow id: `agent:<spaceId>:<agentObjectId>` (`workflowIdFor`), stable across node moves, renames and rotations
- Workflow task queue: `anybot` (`WORKFLOW_TASK_QUEUE`)
- Init data (required): `{ orgId, spaceId, agentId, nodeQueue }` where `nodeQueue` is `node:<spaceId>:<handle>`
- Started by: the event gateway with **update-with-start** ([ADR 0011](../adr/0011-event-gateway.md)); WP7 adds CLI start
- Ends: when the gateway closes it for **rotation** (idle and history long) or archive; the next event starts a new run

## Inputs (v0)

v0 accepts the `chat` update only (`chatUpdate` on AgentCore). The gateway sends `updateId` = the event idempotency key.

| Handler | Input | From |
| --- | --- | --- |
| `chat` | `{ key, chatId, messageId, authorId, text, replyTo? }` | gateway |

Configuration edits need no handler: every turn calls `resolveConfig` fresh. Schedules, object changes, triggers,
tool-approval updates and claims are **not in v0**.

Signals / queries from AgentCore: `close`, `status`, `rotation`.

## A turn (as built)

```
cfg = await resolveConfig({ orgId, spaceId, agentId })   // on nodeQueue
if !cfg.ok: deliver notice "I cannot run right now: <detail>. See anybot doctor."; return
if cfg.spec.lifecycle == paused: return                  // silent
if author not allowed (defence in depth): return         // silent
await markReceived(...)                                  // 👀, best effort
result = await runTurn(...)                              // start-to-close 60m, heartbeat 60s, maximumAttempts: 1
if empty text: deliver notice "The agent finished without writing a reply."; return
await deliver reply (split ≤ tuning.maxMessageChars)     // then 👀 → ✅
```

Failure → exactly one notice, then the loop continues:

| Kind | Notice |
| --- | --- |
| timeout / heartbeat / process died | `That turn was interrupted before it finished. Send the message again.` |
| `HarnessUnavailable` | `<harness> is not installed or not signed in on this machine. Run anybot doctor.` |
| `HarnessError` | `The harness reported an error: <first line, ≤200 chars>.` |
| empty reply | `The agent finished without writing a reply.` |
| invalid / unacceptable / workdir | `I cannot run right now: <detail>. See anybot doctor.` |
| deliver post failed after retries | log only (no second notice) |

- **Queueing.** AgentCore admits updates in order; one turn at a time.
- **Permissions (v0).** `runTurn` answers each harness permission request with `decidePermission(approvalMode, …)`
  (WP4 floor + read_only kinds). No mid-turn `permission` update and no `aa_approval` objects in v0.
- **Session.** Session id is stored on the node (`NodeStore.sessions`, keyed by workflow id). Reused only when
  harness, model and mode are unchanged; survives workflow rotation and worker restart.
- **Idempotent delivery.** `deliver` records `ops(key, message_id)`; a retry with the same key posts nothing.
  A crash between post and record can still duplicate once (accepted for v0).
- **Loop guard** remains in the gateway ([ADR 0011](../adr/0011-event-gateway.md)).

## Rotation

Unchanged from the AgentCore design: the gateway queries `rotation`, sends `close` when idle and history is long,
then update-with-start under the same workflow id. Session id stays on the node.

## Schedules

Not started in WP6 (still gateway / later WP). Spec sketch for later; v0 has no `ScheduleKick`.

## Activities (node task queue `node:<spaceId>:<handle>`, [ADR 0018](../adr/0018-one-or-more-orgs-per-deployment.md))

| Activity | Does | Timeouts / retries |
| --- | --- | --- |
| `resolveConfig` | Read agent via org backend; parse spec; workdir roots; owners | 5 m start-to-close, retry ×3 |
| `markReceived` | 👀 on the inbound message | same; best effort (errors logged) |
| `runTurn` | Open/resume harness; `decidePermission`; heartbeat 10 s; cancel → `session.cancel()` | 60 m, heartbeat 60 s, **maximumAttempts: 1** |
| `deliver` | Post reply or notice; split long replies; swap 👀→✅; idempotent `key` | 5 m, retry ×3 |

`createApproval` / `judgeApproval` are **not in v0**.

## Not in v0

Approvals / ask / auto modes, streaming replies, editable "working…" messages, multi-node, coalescing and mid-turn
steering, schedules/triggers as turns, computer use ([ADR 0016](../adr/0016-computer-use-with-cua.md)).
