# The agent workflow (v0 draft)

One workflow per `aa_agent` ([ADR 0003](../adr/0003-one-shared-temporal-one-workflow-per-agent.md)). It is built with
`defineAgent` from `@temporalio/agent-harness`, installed from npm and pinned
([ADR 0010](../adr/0010-reuse-michel-adapters-and-the-npm-harness.md); API notes in
[research/temporal-agent-harness.md](../research/temporal-agent-harness.md)). Workflow code is deterministic: no clock,
randomness or I/O. Everything that touches the world is an activity on the agent's node.

- Workflow type: `AnyAgent`, exported as `AnyAgent = defineAgent({ name: "AnyAgent", … })`
- Workflow id: `agent:<spaceId>:<agentObjectId>`, stable across node moves, renames and rotations
- Init data (required): `{spaceId, agentId}`. Everything else is read from Anytype at each turn.
- Started by: the event gateway with **update-with-start** ([ADR 0011](../adr/0011-event-gateway.md)), by the
  `ScheduleKick` workflow, or by `anyagent rebuild`
- Ends: when the gateway closes it, either for **rotation** (idle and the history is long; the next event starts a new
  run) or because the agent was archived

## Inputs

### Handlers (each enters through the harness's message update)

Each handler is declared with `handler({description, input, output, midTurn: enqueue, modelCallable: false})`. The
gateway sends the update with `updateId` = the event's idempotency key `key`.

| Handler | Input | From |
| --- | --- | --- |
| `chat` | `{key, groupId, chatId, messageId, authorId, authorKind: person\|agent, authorHandle?, text, replyTo?, mentions[]}` | gateway |
| `objectChanged` | `{key, type, objectId, change: added\|updated\|removed, fields}` | gateway (task changes for lead, assignee and reviewer; `object_change` triggers) |
| `scheduleFired` | `{key: scheduleId+occurrence, scheduleId}` | `ScheduleKick` |
| `triggerFired` | `{key, triggerId, payload}` | gateway (webhook and `chat_pattern` triggers) |

Configuration edits (agent, prompt, group, rules) need no handler: every turn reads its configuration fresh.

### Other inputs

| Kind | Name | Payload | From |
| --- | --- | --- | --- |
| update (harness) | tool approval | `{tool_id, approved, reason?}` | gateway, after verifying the approver ([ADR 0008](../adr/0008-approvals-objects-and-reactions.md)) |
| update (custom) | `permission` | `{requestId, toolName, rawInput, kind}` → `{decision, reason?}` | the node's `runTurn`, mid-turn |
| update (custom) | `claim` | `{taskId, claimant}` → `{granted, assignee}` | another agent's node (lead only, [ADR 0006](../adr/0006-coordination-hierarchy-with-opt-in-claims.md)) |
| signal (harness) | close | | gateway (rotation, archive) |
| query (harness) | status | turn, queue, pending approvals | gateway, CLI |
| query (custom) | `rotation` | `{continueAsNewSuggested, historyLength, idle}` | gateway |

## A turn

Each handler implementation does:

```
config = await act.resolveConfig(agentId)          // Anytype, fresh (live configuration)
if config.lifecycle != live: return a refusal with a notice
runner.setApprovalPolicy(policyFor(config.approvalMode))   // read_only | ask | auto | full
await act.markReceived(input)                      // 👀 / ⏳
result = await act.runTurn({config, input}) on queue node:<config.node>
     // the node drives the harness through Michel's adapters;
     // each permission request comes back as the `permission` update
await act.deliver(result)                          // reply, task writes, ✅ (idempotent, aa_op_key)
return {replyMessageId, usage}
```

- **Queueing.** `midTurn: enqueue`: a delivery that arrives during a turn waits, and each queued delivery becomes its
  own turn, in order. Coalescing several deliveries into one turn (Michel ADR 0014) is not offered by the harness 0.3.1.
  Spike 006 measures whether that matters; mid-turn steering (upstream after 0.3.1) is the likely path.
- **Session.** The harness session id lives on the node next to the harness session itself, keyed by workflow id and
  `aa_session_scope`. It survives rotation, and is dropped when the harness, model or node changes.
- **Loop guard** is in the gateway ([ADR 0011](../adr/0011-event-gateway.md)), which sees each chat in order.

## Permission and approvals

1. The adapter receives a permission request; `runTurn` calls the `permission` update on its own workflow and
   heartbeats while it waits.
2. The handler runs Michel's `preDecision(mode, request)`, which applies the hard floors
   ([ADR 0015](../adr/0015-decision-model-for-approvals.md), [ADR 0013](../adr/0013-agent-permissions-over-the-org.md)).
   `allow` and `deny` return at once.
3. Otherwise the request goes through the harness approval gate. The activity `createApproval` creates the
   `aa_approval` object and its chat message. In `auto` mode the harness also runs the `AutoModeEvaluator`, which
   calls the activity `judgeApproval` (the decision model). The first decision wins: the model's approve/deny, or a
   person's ✅/❌ delivered by the gateway as the tool-approval update. `escalate`, errors and timeouts leave the
   decision to people. The gate's timer on `aa_expires_at` denies.
4. The `permission` update returns the decision; a node activity records `aa_decided_by` (a participant id or
   `model:<endpoint>/<model>`) and `aa_decided_at`.

## Rotation

The harness has no continue-as-new ([research](../research/temporal-agent-harness.md)). The gateway queries `rotation`
after each completed delivery. When `continueAsNewSuggested` is true or the history passes 1,500 accepted updates, and
the run is idle, it sends close. The validator then refuses new messages with `AgentClosed`. The gateway retries them
with update-with-start once the run has ended, which starts a fresh run under the same id. State that must survive a
rotation is not in the workflow: the session id is on the node, the loop-guard count and the delivered keys are in the
gateway, and everything else is in Anytype.

## Schedules

The gateway's reconciler maps each `aa_schedule` to a Temporal Schedule with id
`schedule:<spaceId>:<scheduleObjectId>`:

- spec: `aa_cron` + `aa_timezone`; state: paused unless `aa_enabled` and the owner is `live`;
- action: start the tiny `ScheduleKick` workflow, which sends `scheduleFired` to the owner's workflow with
  update-with-start (a Schedule's action can only start a workflow) and waits for acceptance;
- `aa_next_run` / `aa_last_run` are written back by a node activity, because the gateway never writes to Anytype;
- overlap policy: skip; catch-up window: 10 minutes (data with a default).

The turn for a schedule uses the schedule's body as the prompt and posts to `aa_deliver_to`.

## Activities (node task queue `node:<spaceId>:<handle>`, [ADR 0018](../adr/0018-one-or-more-orgs-per-deployment.md))

| Activity | Does | Timeouts / retries |
| --- | --- | --- |
| `resolveConfig` | Read agent, prompt, groups, rules, permissions from Anytype | 30 s, retry |
| `runTurn` | Drive the harness for one turn; heartbeat every 10 s | start-to-close per agent (default 1 h), heartbeat 60 s, no automatic retry of a turn that started |
| `deliver` | Post reply, reactions, task writes (idempotent with `aa_op_key`; permission-checked) | 60 s, retry |
| `createApproval` | Create `aa_approval` + chat message | 60 s, retry |
| `judgeApproval` | Ask the decision model for a verdict | 30 s, no retry (a failure escalates) |
| `markReceived` | 👀 / ⏳ reactions | 30 s, retry, best effort |

`judgeApproval` runs on a node that has the decision model's endpoint, not necessarily the agent's own node.

## Not in v0

Coalescing and mid-turn steering, loops with completion contracts (Michel ADR 0026), verified gates on a commit
(Michel ADR 0019), computer use ([ADR 0016](../adr/0016-computer-use-with-cua.md)).
