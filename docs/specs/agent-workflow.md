# The agent workflow (v0 draft)

One workflow per `aa_agent` ([ADR 0003](../adr/0003-one-shared-temporal-one-workflow-per-agent.md)), written directly on
`@temporalio/workflow` ([ADR 0010](../adr/0010-reuse-michel-adapters-own-the-workflow.md)). Workflow code is
deterministic: no clock, randomness or I/O; everything that touches the world is an activity on the agent's node.

- Workflow type: `AnyAgent`
- Workflow id: `agent:<spaceId>:<agentObjectId>` (stable across node moves and renames)
- Started by: `signalWithStart` from the event gateway ([ADR 0011](../adr/0011-event-gateway.md)), or by `anyagent rebuild`
- Ends: never, except when the agent object is archived or deleted (signal `retire`)

## Inputs

All signals carry `key` (idempotency) and `at` (source timestamp). The workflow keeps the last 1,000 keys and ignores
repeats.

| Kind | Name | Payload | From |
| --- | --- | --- | --- |
| signal | `chatMessage` | `{key, groupId, chatId, messageId, authorId, authorHandle?, text, replyTo?, mentions[]}` | gateway |
| signal | `objectChanged` | `{key, type, objectId, change: added\|updated\|removed, fields}` | gateway |
| signal | `scheduleFired` | `{key: scheduleId+occurrence, scheduleId}` | Temporal Schedule action |
| signal | `triggerFired` | `{key, triggerId, payload}` | gateway (webhook, object or chat trigger) |
| signal | `approvalDecided` | `{key, approvalId, decision, decidedBy, reason?}` | gateway |
| signal | `configChanged` | `{key, objectId}` | gateway (agent, prompt, group, rules edited) |
| signal | `retire` | `{key}` | gateway (agent archived) |
| update | `claim` | `{taskId, claimant}` → `{granted: boolean, assignee}` | another agent's turn (lead only) |
| update | `permission` | `{requestId, toolName, rawInput, kind}` → `{decision, reason?}` | the node, mid-turn |
| query | `state` | → `{status, pending, currentTurn?, sessionId?, waitingApproval?}` | CLI, node |

## State

```ts
interface AgentState {
  pending: Delivery[];          // coalesced inbox, bounded (e.g. 50; overflow summarised)
  turn?: { id: string; startedAt: string };
  sessionId?: string;           // harness session to resume
  waiting?: { approvalId: string; requestId: string; expiresAt: string };
  hopsSinceHuman: Record<string, number>;  // per group, loop guard
  seenKeys: string[];           // ring buffer for idempotency
  claimsGranted: Record<string, string>;   // taskId -> assignee (lead only)
}
```

## Main loop

```
loop:
  await condition(pending.length > 0 || retire)
  if retire: return
  batch = take(pending)                       // everything that arrived, as one turn
  config = await act.resolveConfig(agentId)   // reads Anytype fresh (live configuration)
  if config.lifecycle != live: drop batch with a notice; continue
  await act.markReceived(batch)               // 👀 / ⏳ reactions
  result = await act.runTurn({config, batch, sessionId}) on queue node:<config.node>
       // inside: adapter.prompt(...); permission requests -> update `permission`
  sessionId = result.sessionId (or undefined when the session was dropped)
  await act.deliver(result)                   // reply in chat, task writes, ✅
  if historyLengthOrUpdates > threshold and no turn in flight: continueAsNew(state)
```

- **Coalescing** (Michel ADR 0014): deliveries that arrive during a turn wait for the next one; the next turn carries
  them all. A `stop` keyword from an approver cancels the running activity.
- **Loop guard**: a chat message from another agent increments `hopsSinceHuman[group]`; at `aa_max_hops` the delivery
  is dropped with a notice. A human message resets it.
- **continueAsNew** happens only between turns, carrying `pending`, `sessionId`, `seenKeys` and `hopsSinceHuman`. This
  is the capability Michel lacked with the vendored harness.

## Permission and approvals

1. The adapter receives a permission request; the activity calls the `permission` update on its own workflow.
2. The update handler runs `preDecision(mode, request)` (pure, from Michel). `allow` / `deny` return at once.
3. `ask`: the handler starts an approval (activity `createApproval`), sets `waiting`, and awaits `approvalDecided` or
   `expires_at` (a workflow timer). The update returns the decision; the activity answers the harness.
4. The running activity heartbeats while it waits, so Temporal does not time it out.

## Schedules

The gateway's reconciler maps each `aa_schedule` to a Temporal Schedule with id
`schedule:<spaceId>:<scheduleObjectId>`:

- spec: `aa_cron` + `aa_timezone`; state: paused unless `aa_enabled` and the owner is `live`;
- action: start-or-signal the owner's workflow with `scheduleFired` (implemented as a tiny `ScheduleKick` workflow that
  does `signalWithStart`, since a Schedule's action starts a workflow); `aa_next_run` / `aa_last_run` are written back by
  a node activity, because the gateway never writes to Anytype;
- overlap policy: skip; catch-up window: 10 minutes (data with a default).

The turn for a schedule uses the schedule's body as the prompt and posts to `aa_deliver_to`.

## Activities (node task queue `node:<handle>`)

| Activity | Does | Timeouts / retries |
| --- | --- | --- |
| `resolveConfig` | Read agent, prompt, groups, rules from Anytype | 30 s, retry |
| `runTurn` | Drive the harness for one turn; heartbeat every 10 s | start-to-close per agent (default 1 h), heartbeat 60 s, no automatic retry of a turn that started |
| `deliver` | Post reply, reactions, task writes (idempotent with `aa_op_key`) | 60 s, retry |
| `createApproval` | Create `aa_approval` + chat message | 60 s, retry |
| `markReceived` | 👀 / ⏳ reactions | 30 s, retry, best effort |

## Not in v0

Mid-turn steering (Michel's `immediate` delivery mode), loops with completion contracts (Michel ADR 0026), verified
gates on a commit (Michel ADR 0019).
