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
│ dedupe → route → update-with-start    │  │ harness adapters:        │  │              │
│ reconciler: aa_schedule → Schedules   │  │   claude-code, codex,    │  │              │
└────────┬──────────────────────────────┘  │   opencode, openai, acp  │  │              │
         │ updates                         └───▲──────────────────────┘  └───▲──────────┘
         ▼                                     │ activities                   │
┌──────────────────────────── one shared Temporal ──────────────────────────────┐
│ AnyAgent (defineAgent, npm harness) per agent · Temporal Schedules            │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Component | Runs where | Responsibility |
| --- | --- | --- |
| **Anytype space** | every member's device, synced p2p by any-sync | Source of truth: the org, the work, the conversation ([ADR 0002](adr/0002-anytype-is-the-source-of-truth.md)). |
| **Event gateway** | one per deployment, next to Temporal ([ADR 0011](adr/0011-event-gateway.md)) | The only way in: Anytype chat and object streams, webhooks → dedupe → route → update-with-start. Loop guard, rotation, schedule reconciler. Reads Anytype, never writes. |
| **Temporal** | one per deployment: self-hosted or Temporal Cloud, chosen by configuration ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)) | One workflow per agent, Temporal Schedules, serialised updates. |
| **Agent workflow** | Temporal (deterministic code) | `defineAgent` from `@temporalio/agent-harness` (npm, pinned): turn queue, approval gate and auto mode, claims. Spec: [agent-workflow.md](specs/agent-workflow.md). |
| **Node** | each machine that runs agents | Temporal worker on `node:<handle>`; runs turns through harness adapters; writes to Anytype through the endpoint of each agent's account ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)). |
| **`anytype serve`** | one per Anytype account, anywhere on the private network | Anytype JSON API (`:31012`) for that account ([research](research/anytype-api.md)). One shared account, a pool, or one per agent ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)). |
| **Harness adapters** | node, inside activities | Claude Code, Codex, OpenCode, any ACP agent, OpenAI-compatible APIs ([ADR 0010](adr/0010-reuse-michel-adapters-and-the-npm-harness.md)). |
| **Model endpoints** | node config | llama.cpp (`llama-server`) and any OpenAI-compatible API, local or cloud, for agents and the decision model ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)). |
| **Tool profiles** | node config | MCP servers given to harnesses; computer use through cua after v0 ([ADR 0016](adr/0016-computer-use-with-cua.md)). |

Read and write paths are split: the gateway has a **read-only** key as a space **viewer**; nodes have read-write keys
and post through their agents' accounts. A compromised gateway can wake agents but cannot write to the space.

**Accounts** ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)): each agent links one `aa_account`. All agents
on one bot account, a pool of shared accounts, or one account each are the same code with different data. On a shared
account, agents add a handle tag (`**@handle**`) and the tag says who spoke; on an exclusive account, the account does.
People never share an account with agents, so a person's message or approval cannot come from an agent.

**Infrastructure choices are configuration**: Temporal self-hosted or Cloud ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)),
Anytype's sync network or a self-hosted any-sync ([ADR 0012](adr/0012-any-anytype-sync-network.md)), local or cloud
models ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)). An all-local deployment needs no cloud account.

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
update-with-start (the harness message update, `updateId` = key) → commit cursor once the update is accepted. A crash
re-delivers; a repeated key is dropped by Temporal within a run and by the gateway's key store across runs.

**Routing a chat message** (in the chat of an `aa_group`):

| Message | Signalled |
| --- | --- |
| Authored by an agent account (resolved to an agent by account or tag) | agents it @mentions only, counted against `aa_max_hops` |
| Authored by a shared agent account without a valid tag | nobody (unattributed agent message) |
| @mentions `@handle` | those agents |
| `@all` / `@everyone` | every member agent |
| No mention | by `aa_routing`: `lead` (default) → the lead; `everyone`; `none` |
| Author not in `aa_allowed_authors` (when set) and not a node | nobody |

**Routing an object change**: an `aa_task` change → its lead, assignee and reviewer; an `aa_approval` decision → the
requester (after verifying the approver, §6); an edit to `aa_agent` / `aa_prompt` / `aa_group` / rules → nothing to
deliver (the next turn reads it), except archiving an agent, which closes its workflow; `aa_schedule` / `aa_trigger`
changes → the reconciler; `object_change` triggers → their owners. An org change by an agent account without the
permission is ignored once authors can be read ([ADR 0013](adr/0013-agent-permissions-over-the-org.md), spike 005).

### 3.2 The turn

Each delivery is a harness handler call. Deliveries that arrive during a turn are queued, and each becomes the next turn
(the harness 0.3.1 does not coalesce; spike 006). The turn reads the agent's configuration fresh from Anytype, calls
`runTurn` on the agent's node, which drives the harness and answers permission requests through an update to the
workflow, and returns the reply, usage and session id. The session id stays on the node, so it survives rotation.

### 3.3 Out: nodes write

Only node activities write to Anytype, through the endpoint of the agent's `aa_account` (local or remote
`anytype serve`), with the handle tag when the account is shared:

- **Replies** with `reply_to` the triggering message; visible text only, no thinking or tool inputs.
- **Receipts**: 👀 (seen), ⏳ (working), ✅ (done) reactions, removed when outdated.
- **Work**: create or patch `aa_task`, `aa_approval`, schedule projections. Idempotent: each write carries an operation
  key (`aa_op_key`) and the activity reads before it writes.
- **Org changes** (agents, groups, schedules, triggers) only within the agent's `aa_permissions`, checked on this path;
  rights, approvers and accounts are written by people only ([ADR 0013](adr/0013-agent-permissions-over-the-org.md)).

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
  whose `ScheduleKick` action wakes the owner's workflow; overlap: skip. `aa_next_run` / `aa_last_run` are written back by a node activity.
- **Triggers**: `webhook` (gateway endpoint + HMAC with a secret in the gateway config), `object_change` (a saved
  search evaluated on the object stream), `chat_pattern` (a regex on a group's chat). New kinds are registry entries.

## 6. Approvals ([ADR 0008](adr/0008-approvals-objects-and-reactions.md))

1. A permission request reaches the workflow as an update; `preDecision` (agent's `aa_approval_mode`) allows, denies or
   asks, and applies the hard floors.
2. Ask: a node activity creates `aa_approval` and a chat message linking it; the harness approval gate waits (timer on
   `aa_expires_at`).
3. In `auto` mode a **decision model** (local or cloud, [ADR 0015](adr/0015-decision-model-for-approvals.md)) judges
   the call against the agent's criteria **in a race with you**: the first decision wins, and `escalate`, errors and
   timeouts leave it to you. It never fails open.
4. You react ✅ / ❌ or set `aa_status`. On `reactions_updated` (counts only), the gateway re-reads the message with
   `?reactions=full` and forwards the decision only if a participant id is in `aa_approvers`. An object edit counts only
   if its author is an approver ([SPIKES.md](SPIKES.md) 005).
5. The workflow resumes or refuses with the reason; a node records `aa_decided_by` (a participant id or
   `model:<endpoint>/<model>`) and `aa_decided_at`.

## 7. Live configuration

At each turn boundary the node reads the `aa_agent`, its `aa_prompt`, its groups and the space rules. A change applies
at the next turn, never mid-turn; a change of harness, model or node starts a new session. Nothing is copied into
another tool's config.

## 8. Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Node down | Its agents' turns wait in Temporal; deliveries keep queuing in the workflows | Node returns and polls; turns run |
| Gateway down | Nothing wakes; Anytype keeps working for people; webhooks get errors | Restart: chat resumes from cursors, object stream re-snapshots and is diffed against the cache |
| Gateway cursor file lost | Possible re-delivery | Temporal drops a repeated update id within a run |
| `anytype serve` down (node) | That node cannot read config or write | Activities retry with backoff |
| Temporal down | No turns, no schedule fires, no deliveries (gateway buffers by not committing cursors) | Resume where they were |
| Decision model down | `auto` mode escalates every gated call to people | Approvals wait for a person |
| Temporal wiped | Execution history lost, nothing about the org | `anyagent rebuild`: one workflow per live agent, schedules reconciled |
| Concurrent object edits | any-sync merges | One writer per field; claims through a Temporal update |

## 9. Extension points

- **Harnesses**: registry entries in `packages/harness` ([ADR 0010](adr/0010-reuse-michel-adapters-and-the-npm-harness.md)).
- **Gateway source kinds** and **trigger kinds**: registries ([ADR 0011](adr/0011-event-gateway.md)).
- **Routing modes** for unaddressed messages: `lead`, `everyone`, `none`; an `auto` router model later.
- **Identity** port: agents map to accounts by data; one implementation covers one shared account, a pool, and one
  account per agent ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)).
- **AnytypeClient** port: HTTP/SSE in v0; embedded heart possible later ([ADR 0004](adr/0004-typescript-over-the-http-api.md)).
- **Permissions**: registry of permission ids ([ADR 0013](adr/0013-agent-permissions-over-the-org.md)).
- **Model endpoint kinds** (`openai_compatible` in v0, covering llama.cpp) ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)).
- **Approval evaluators** (`model` in v0) ([ADR 0015](adr/0015-decision-model-for-approvals.md)).
- **Tool-profile kinds**, including `computer` (cua first) ([ADR 0016](adr/0016-computer-use-with-cua.md)).

## 10. Deliberately not generalised (v0)

- One space per deployment, one gateway (no HA pair yet).
- No chat platforms besides Anytype; no sandbox in v0 (cua sandboxes come with computer use, after v0); no migration
  from the `anytype-agents` schema.
