# Architecture

Status: **proposed** (specification stage). Decisions are in [adr/](adr/); open points in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## 1. Components

```
┌──────────────────────────────── Anytype space ────────────────────────────────┐
│  objects: aa_agent · aa_group · aa_task · aa_schedule · aa_trigger ·          │
│           aa_approval · aa_node · aa_prompt          chats: one per aa_group  │
└───────▲───────────────────────────────────────────────────────▲───────────────┘
        │ HTTP + SSE (JSON API v2, API key)                      │  same space, synced p2p
┌───────┴───────────────────────── node A ─────────┐   ┌────────┴──── node B ────┐
│ anytype serve (bot account "node-a", :31012)      │   │ anytype serve (node-b)  │
│ anyagent node                                     │   │ anyagent node           │
│  ├─ Ingress: chat + object streams → signals      │   │  …                      │
│  ├─ Reconciler: aa_schedule/aa_trigger → Temporal │   │                         │
│  ├─ Webhook listener (optional)                   │   │                         │
│  ├─ Worker on task queue "node:node-a"            │   │                         │
│  │    activities: runTurn, post, patch, read      │   │                         │
│  └─ Harness adapters: claude-code, codex, openai… │   │                         │
└───────────────────────▲──────────────────────────┘   └────────▲────────────────┘
                        │ gRPC                                   │
                ┌───────┴────────────── one shared Temporal ─────┴───────┐
                │ workflow per agent: agent:<space>:<agentObjectId>      │
                │ Temporal Schedules for aa_schedule objects             │
                └────────────────────────────────────────────────────────┘
```

| Component | Runs where | Responsibility |
| --- | --- | --- |
| **Anytype space** | every member's device, synced p2p by any-sync | Source of truth: the org, the work, the conversation. |
| **`anytype serve`** | one per node, logged in as that node's bot account ([ADR 0005](adr/0005-identity-one-account-per-node-first.md)) | Local Anytype API on `127.0.0.1:31012` ([research](research/anytype-api.md)). |
| **anyagent node** | each machine that runs agents | Ingress, reconciler, webhook listener, Temporal worker, harness adapters. |
| **Temporal** | one shared cluster, self-hosted or Cloud ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)) | One workflow per agent, Temporal Schedules, serialised updates. |
| **Agent workflow** | Temporal (deterministic code, no I/O) | The agent's inbox, turn loop, approvals wait, claims. Spec: [agent-workflow.md](specs/agent-workflow.md). |
| **Harness adapters** | node, inside activities | Drive Claude Code, Codex, OpenCode, any ACP agent, or an OpenAI-compatible API ([ADR 0010](adr/0010-reuse-michel-adapters-own-the-workflow.md)). |

## 2. Placement: which node runs what

- Every `aa_agent` names its **home node** (`node` → `aa_node`). Its turns run as activities on that node's task queue
  (`node:<handle>`), because that is where its harness, login and working directory are.
- Every `aa_node` has exactly one Anytype account (v0) and one `anytype serve`. The node writes to Anytype as that
  account, so messages from its agents are authored by the node account and carry the agent's handle
  ([ADR 0005](adr/0005-identity-one-account-per-node-first.md)).
- **Each node forwards only events that concern its own agents.** All nodes in a space see the same streams; a node
  ignores any event whose target agent lives elsewhere. This removes duplicate signals without a coordinator.
- Moving an agent = editing `aa_agent.node`. The old node stops forwarding, the new one starts; the workflow id does not
  change, so history and queue survive. The move applies at a turn boundary.

## 3. Event flow: from Anytype to a turn and back

### 3.1 Ingress (Anytype → Temporal)

The node opens, per space it belongs to:

1. `GET /v2/spaces/{space}/chats/stream`: every chat in the space, to learn chats and see live messages. It has no replay.
2. `GET /v2/spaces/{space}/chats/{chat}/messages/stream` per chat bound to an `aa_group` with a local member, resuming
   from the last persisted state id with `Last-Event-ID` (additions only are replayed; `resync_required` means re-read).
3. `POST /v2/spaces/{space}/search/stream` with the anyagent types (`aa_task`, `aa_approval`, `aa_agent`, `aa_schedule`,
   `aa_trigger`, `aa_group`, `aa_prompt`): a snapshot, then live `object_added` / `object_updated` / `object_removed`.

Proven in TypeScript against a mock of heart's exact framing: [spike 001](../spikes/001-ts-sse/). Not yet against a live
`anytype serve` ([SPIKES.md](SPIKES.md) 002).

Each event goes through: **dedupe** (message id or object id + `last_modified_date`) → **route** (which local agents
does it concern?) → **signal** the agent workflow with `signalWithStart`, carrying an idempotency key. Cursors (chat
state ids) are persisted on the node after the signal is accepted, so a crash re-delivers and never drops; the workflow
ignores a key it has already seen.

**Routing rules for a chat message** (in the chat of an `aa_group`):

| Message | Who is signalled |
| --- | --- |
| From the node's own account with an agent handle tag (an agent's own reply) | nobody (self-echo filter) |
| @mentions `@handle` of one or more agents | those agents |
| `@all` / `@everyone` | every member agent |
| No mention | per `aa_group.routing`: `lead` (default) → the group lead; `everyone`; `none` |
| From an author not in `aa_group.allowed_authors` and not a member agent | nobody; optionally a notice |

Agent-to-agent loops are capped like Hermes Bot Mode (`max_hops` since the last human message, default 4).

### 3.2 The turn (Temporal → node → harness)

The workflow coalesces pending signals into **one turn** when the agent is idle (Michel ADR 0014 semantics: a batch, not
a queue of turns). It calls the activity `runTurn` on the agent's node with: the agent's resolved configuration (read
fresh from Anytype at the turn boundary), the batch, and the session id. The activity drives the harness through the
adapter, answers permission requests by calling back into the workflow (an update), and returns the reply text, usage
and session id.

### 3.3 Egress (node → Anytype)

Only activities write to Anytype, always through the agent's home node:

- **Replies**: `POST /v2/spaces/{s}/chats/{c}/messages` with the agent's handle tag and `reply_to` the triggering
  message. Visible text only; no thinking, no tool inputs.
- **Receipts**: reactions 👀 (seen), ⏳ (working), ✅ (done) on the triggering message, removed when outdated.
- **Work**: create or patch `aa_task`, `aa_approval`, results. Writes are idempotent: each carries an operation key
  stored on the object (`aa_op_key`), and the activity reads before it writes.

## 4. Work: tasks and coordination ([ADR 0006](adr/0006-coordination-hierarchy-with-opt-in-claims.md), [ADR 0007](adr/0007-chat-for-talk-objects-for-work.md))

- A request that needs durable work becomes an **`aa_task`** linked from the chat message (`origin_message`) and the
  group. Its `lead` is the agent responsible for assignment.
- **Hierarchy (default):** only the task's `lead` writes `assignee`. Agents never self-assign. Each field has one writer,
  so Anytype's merge of concurrent edits cannot produce two owners.
- **Claims (opt-in per group, `claims: true`):** an eligible agent sends a `claim` **Temporal update** to the lead's
  workflow. Updates on one workflow are processed one at a time, so the lead accepts exactly one claim and then writes
  `assignee`. This is the only agent-to-agent path that bypasses Anytype, because it needs a linearizable answer; its
  outcome is written to Anytype immediately.
- **Status** flows `backlog → ready → in_progress → review → done` (plus `blocked`, `cancelled`). The assignee owns
  `in_progress`/`review`; the lead owns `done`/`cancelled`. A `review` stage can name a `reviewer` different from the
  assignee (Michel ADR 0019's "a different agent verifies").
- A change to a task is an object event; ingress signals the assignee and the lead.

## 5. Time and the outside world

- **Schedules** ([agent-workflow.md](specs/agent-workflow.md#schedules)): each live `aa_schedule` (cron + timezone +
  prompt) is reconciled into a **Temporal Schedule** whose action signals the owner agent's workflow. The reconciler runs
  on the owner's home node and writes `next_run` / `last_run` back to the object. Temporal guarantees one fire per
  occurrence; overlap policy defaults to skip.
- **Triggers** ([schema.md](specs/schema.md#aa_trigger)): `webhook` (an HTTP listener on a node verifies an HMAC with a
  secret stored only on that node, then signals), `object_change` (a saved search on the object stream), `chat_pattern`
  (a regex on a group's chat). New kinds are registry entries.

## 6. Approvals ([ADR 0008](adr/0008-approvals-objects-and-reactions.md))

1. A harness asks permission (or an agent declares a risky action). The workflow evaluates the agent's `approval_mode`
   (`read_only` / `ask` / `auto` / `full`, Michel's `preDecision`).
2. If a person must decide: an activity creates an `aa_approval` (summary, risk, requested action, requester, task) and
   posts a chat message linking it, then the workflow **waits** (bounded by `expires_at`).
3. You react ✅ or ❌, or set `status` on the object. The stream's `reactions_updated` carries counts only, so the node
   re-reads the message with `?reactions=full` and accepts the decision only if a participant id is on the
   `approvers` allowlist ([research](research/anytype-api.md#reactions)). Object edits are accepted only if the
   space's change author is an approver (verification method: [SPIKES.md](SPIKES.md) 005).
4. The node writes the decision (`decided_by`, `decided_at`) and signals the workflow, which resumes or refuses the tool
   call with the reason.

## 7. Configuration is live

At each turn boundary the workflow asks the node for the agent's resolved configuration: the `aa_agent` object, its
`aa_prompt`, the group's rules, and the space's `aa_prompt` of kind `rules`. A change applies at the next turn, never
mid-turn. A change of harness, model or node starts a new harness session. Nothing is copied into Hermes, Osaurus or a
config file.

## 8. Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Node down | Its agents' turns wait in Temporal (activity schedule-to-start); its schedules still fire into the workflow and queue | Node returns, worker polls, turns run; ingress resumes from persisted cursors |
| `anytype serve` down | Node cannot read or write Anytype; activities fail and retry with backoff | Restart; streams reconnect with `Last-Event-ID` |
| Temporal down | No turns, no schedule fires; Anytype keeps working for people | Temporal returns; workflows resume where they were |
| Temporal wiped | Execution history lost; nothing about the org is lost | `anyagent rebuild` starts one workflow per live `aa_agent` and reconciles schedules |
| Stream gap | `resync_required`, or a reconnect of the space stream (no replay) | Re-read recent messages per chat; dedupe by message id |
| Duplicate event | Two nodes or a retry signal twice | Idempotency key per event; each node forwards only its own agents |
| Concurrent object edits | any-sync merges; last-writer semantics per field | One writer per field (lead/assignee split); claims through a Temporal update |

## 9. Extension points

- **Harnesses**: registry entries in the adapter package ([ADR 0010](adr/0010-reuse-michel-adapters-own-the-workflow.md)).
- **Trigger kinds**: a registry of `{kind, validate, matcher, toSignal}`.
- **Routing modes** for unaddressed messages: `lead`, `everyone`, `none`; `auto` (a cheap router model, as in Hermes)
  later as a new mode.
- **Identity**: the `Identity` port (how a node posts as an agent) has one implementation in v0 (node account + handle
  tag) and a planned second (one account per agent).
- **Anytype access**: an `AnytypeClient` port with the HTTP/SSE implementation; an embedded-heart implementation stays
  possible ([ADR 0004](adr/0004-typescript-over-the-http-api.md)).

## 10. Deliberately not generalised (v0)

- One space per deployment in v0 (multi-space is a loop over the same code, but untested).
- No chat platforms besides Anytype.
- No sandbox; harnesses run on the node.
- No auto-migration from the `anytype-agents` schema.
