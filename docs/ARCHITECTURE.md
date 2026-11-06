# Architecture

Status: **proposed** (specification stage). Decisions are in [adr/](adr/); open points in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## 1. Components

```
                         you: Anytype desktop / mobile (chat, objects, ✅/❌)
                                         │
┌──────────────────────────────── Anytype space (p2p) ─────────────────────────────────┐
│ aa_agent · aa_group (+ chat) · aa_task · aa_schedule · aa_trigger · aa_approval · …  │
└────────▲ read (SSE)                          ▲ write (HTTP)                ▲ write    │
         │                                     │                             │
┌────────┴──────────── event gateway ───┐  ┌───┴──────── node A ──────┐  ┌───┴─ node B ─┐
│ anytype serve (viewer, read-only key) │  │ anytype serve (node-a)   │  │ …            │
│ sources: chat SSE, object SSE,        │  │ Temporal worker          │  │              │
│          webhooks  ◄── POST /hooks/…  │  │   queue node:node-a      │  │              │
│ dedupe → route → signalWithStart      │  │ harness adapters:        │  │              │
│ reconciler: aa_schedule → Schedules   │  │   claude-code, codex,    │  │              │
└────────┬──────────────────────────────┘  │   opencode, openai, acp  │  │              │
         │ signals                         └───▲──────────────────────┘  └───▲──────────┘
         ▼                                     │ activities                   │
┌──────────────────────────── one shared Temporal ──────────────────────────────┐
│ AnyAgent workflow per agent (agent:<space>:<agentId>) · Temporal Schedules    │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Component | Runs where | Responsibility |
| --- | --- | --- |
| **Anytype space** | every member's device, synced p2p by any-sync | Source of truth: the org, the work, the conversation ([ADR 0002](adr/0002-anytype-is-the-source-of-truth.md)). |
| **Event gateway** | one per deployment, next to Temporal ([ADR 0011](adr/0011-event-gateway.md)) | The only way in: Anytype chat and object streams, webhooks → dedupe → route → signal. Reconciles schedules. Reads Anytype, never writes. |
| **Temporal** | one shared cluster, self-hosted or Cloud ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)) | One workflow per agent, Temporal Schedules, serialised updates. |
| **Agent workflow** | Temporal (deterministic code) | Inbox, turn loop, approval wait, claims. Spec: [agent-workflow.md](specs/agent-workflow.md). |
| **Node** | each machine that runs agents | Temporal worker on `node:<handle>`; runs turns through harness adapters; writes to Anytype as its account ([ADR 0005](adr/0005-identity-one-account-per-node-first.md)). |
| **`anytype serve`** | gateway and each node, each with its own bot account | Local Anytype JSON API on `127.0.0.1:31012` ([research](research/anytype-api.md)). |
| **Harness adapters** | node, inside activities | Claude Code, Codex, OpenCode, any ACP agent, OpenAI-compatible APIs ([ADR 0010](adr/0010-reuse-michel-adapters-own-the-workflow.md)). |

Read and write paths are split: the gateway has a **read-only** key as a space **viewer**; nodes have read-write keys
and post as themselves. A compromised gateway can wake agents but cannot write to the space.

## 2. Placement

- Every `aa_agent` names its **home node** (`aa_node`). Its turns run as activities on that node's task queue, where
  its harness, login and working directory are.
- Moving an agent = editing `aa_agent.aa_node`. The workflow id does not change; the next turn runs on the new node.
- A node needs network reach to Temporal and to its own local `anytype serve`, nothing else. A node behind NAT with no
  public address works.
- The gateway needs reach to Temporal and its own `anytype serve`, and exposes one HTTPS endpoint for webhooks (behind
  a reverse proxy or a tunnel).

## 3. Event flow

### 3.1 In: the gateway

Per space, the gateway holds open:

1. `GET /v2/spaces/{s}/chats/stream`: learns chats (`chat_added`) and sees live messages; no replay.
2. `GET /v2/spaces/{s}/chats/{c}/messages/stream` for each chat bound to an `aa_group`, resumed with `Last-Event-ID`
   from its stored cursor (additions are replayed; `resync_required` → re-read recent messages).
3. `POST /v2/spaces/{s}/search/stream` over the `aa_*` types: snapshot, then `object_added` / `object_updated` /
   `object_removed`. The snapshot also fills the gateway's routing cache (agents, groups, triggers, schedules).

and serves `POST /hooks/{triggerId}` for `webhook` triggers.

Proven in TypeScript against a mock of heart's exact framing: [spike 001](../spikes/001-ts-sse/). Not yet against a
live `anytype serve` ([SPIKES.md](SPIKES.md) 002).

**Pipeline**: normalise → dedupe (key: message id, `objectId@last_modified_date`, webhook delivery id) → route →
`signalWithStart` → commit cursor. The cursor is committed only after Temporal accepts the signal; workflows drop
repeated keys, so a crash re-delivers and never double-executes.

**Routing a chat message** (in the chat of an `aa_group`):

| Message | Signalled |
| --- | --- |
| Authored by a node account (an agent's own reply) | agents it @mentions only, counted against `aa_max_hops` |
| @mentions `@handle` | those agents |
| `@all` / `@everyone` | every member agent |
| No mention | by `aa_routing`: `lead` (default) → the lead; `everyone`; `none` |
| Author not in `aa_allowed_authors` (when set) and not a node | nobody |

**Routing an object change**: an `aa_task` change → its lead, assignee and reviewer; an `aa_approval` decision → the
requester (after verifying the approver, §6); an edit to `aa_agent` / `aa_prompt` / `aa_group` / rules → `configChanged`
to the affected agents; `aa_schedule` / `aa_trigger` changes → the reconciler; `object_change` triggers → their owners.

### 3.2 The turn

The workflow coalesces pending signals into **one turn** when the agent is idle (Michel ADR 0014). It calls `runTurn`
on the agent's node with the batch and the session id; the node reads the agent's configuration fresh from Anytype,
drives the harness, answers permission requests through an update to the workflow, and returns the reply, usage and
session id.

### 3.3 Out: nodes write

Only node activities write to Anytype, as the node's account with the agent's handle tag:

- **Replies** with `reply_to` the triggering message; visible text only, no thinking or tool inputs.
- **Receipts**: 👀 (seen), ⏳ (working), ✅ (done) reactions, removed when outdated.
- **Work**: create or patch `aa_task`, `aa_approval`, schedule projections. Idempotent: each write carries an operation
  key (`aa_op_key`) and the activity reads before it writes.

## 4. Work and coordination ([ADR 0006](adr/0006-coordination-hierarchy-with-opt-in-claims.md), [ADR 0007](adr/0007-chat-for-talk-objects-for-work.md))

- Durable work is an `aa_task` linked from the chat message that asked for it (`aa_origin_message`) and its group.
- **Hierarchy (default)**: only the task's lead writes `aa_assignee`, `done` and `cancelled`; agents never self-assign.
  One writer per field, so Anytype's merging cannot produce two owners.
- **Claims (opt-in, `aa_claims`)**: an agent sends a `claim` Temporal update to the lead's workflow; updates are handled
  one at a time, so exactly one claim wins, and the lead's node writes the assignee.
- Status: `backlog → ready → in_progress → review → done` (+ `blocked`, `cancelled`); an optional reviewer who is not
  the assignee moves `review → done`.

## 5. Time and triggers

- **Schedules**: the gateway's reconciler maps each `aa_schedule` (cron, timezone, enabled) to a Temporal Schedule
  that signals the owner's workflow; overlap: skip. `aa_next_run` / `aa_last_run` are written back by a node activity.
- **Triggers**: `webhook` (gateway endpoint + HMAC with a secret in the gateway config), `object_change` (a saved
  search evaluated on the object stream), `chat_pattern` (a regex on a group's chat). New kinds are registry entries.

## 6. Approvals ([ADR 0008](adr/0008-approvals-objects-and-reactions.md))

1. A permission request reaches the workflow as an update; `preDecision` (agent's `aa_approval_mode`) allows, denies or
   asks.
2. Ask: a node activity creates `aa_approval` and a chat message linking it; the workflow waits (timer on
   `aa_expires_at`).
3. You react ✅ / ❌ or set `aa_status`. On `reactions_updated` (counts only), the gateway re-reads the message with
   `?reactions=full` and forwards the decision only if a participant id is in `aa_approvers`. An object edit counts only
   if its author is an approver ([SPIKES.md](SPIKES.md) 005).
4. The workflow resumes or refuses with the reason; a node records `aa_decided_by` / `aa_decided_at`.

## 7. Live configuration

At each turn boundary the node reads the `aa_agent`, its `aa_prompt`, its groups and the space rules. A change applies
at the next turn, never mid-turn; a change of harness, model or node starts a new session. Nothing is copied into
another tool's config.

## 8. Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Node down | Its agents' turns wait in Temporal; signals keep queuing in the workflows | Node returns and polls; turns run |
| Gateway down | Nothing wakes; Anytype keeps working for people; webhooks get errors | Restart: chat resumes from cursors, object stream re-snapshots and is diffed against the cache |
| Gateway cursor file lost | Possible re-delivery | Workflows drop repeated keys |
| `anytype serve` down (node) | That node cannot read config or write | Activities retry with backoff |
| Temporal down | No turns, no schedule fires, no signals (gateway buffers by not committing cursors) | Resume where they were |
| Temporal wiped | Execution history lost, nothing about the org | `anyagent rebuild`: one workflow per live agent, schedules reconciled |
| Concurrent object edits | any-sync merges | One writer per field; claims through a Temporal update |

## 9. Extension points

- **Harnesses**: registry entries in `packages/harness` ([ADR 0010](adr/0010-reuse-michel-adapters-own-the-workflow.md)).
- **Gateway source kinds** and **trigger kinds**: registries ([ADR 0011](adr/0011-event-gateway.md)).
- **Routing modes** for unaddressed messages: `lead`, `everyone`, `none`; an `auto` router model later.
- **Identity** port: node account + handle tag in v0; one account per agent planned ([ADR 0005](adr/0005-identity-one-account-per-node-first.md)).
- **AnytypeClient** port: HTTP/SSE in v0; embedded heart possible later ([ADR 0004](adr/0004-typescript-over-the-http-api.md)).

## 10. Deliberately not generalised (v0)

- One space per deployment, one gateway (no HA pair yet).
- No chat platforms besides Anytype; no sandbox; no migration from the `anytype-agents` schema.
