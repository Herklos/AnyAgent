# Roadmap: releases v0 to v3

> Detailed, step by step build plans, each in work packages with scope, tests, checks and achievements: [v0](roadmap/v0/README.md) (nine packages), [v1](roadmap/v1/README.md) (eight), [v2](roadmap/v2/README.md) (eight) and [v3](roadmap/v3/README.md) (six). Each release starts only when the previous one is released.

The plan is four small releases, each usable on its own, most important first. **v0 is as small as it can be while still
being worth using**; every later release adds one theme and is finished (tests, docs, migration) before the next
starts. Dates are not promised: the order is.

> **Terminology.** ADRs and specs written before 2026-11-07 use "v0" for *the first full slice*: the old v0 acceptance,
> which this plan delivers across v0 to v3 (the table at the end maps each old point). "Not in v0" in those documents
> means "not in that first full slice"; the release that actually delivers an item is the one named here. Release
> numbers are used only in this document. The ADRs are reworded as they are next changed (rule: an ADR changes with the
> behaviour it decides).

## How the order was chosen

Each feature was ranked by, in this order:

1. **Value to the first real user** (the owner): does it let them do something they cannot do otherwise?
2. **Risk retired early**: does it test the least certain parts (Anytype's live streams, the npm harness, durable
   turns) while changing course is cheap?
3. **Dependencies**: nothing ships before what it needs.
4. **Safety**: nothing that lets agents change the world ships before the control that limits it.

## At a glance

| Release | Theme | The owner can… | Rough size |
| --- | --- | --- | --- |
| **v0** | One agent in a chat | …talk to an AI agent running on their machine from Anytype (desktop or phone); it keeps working across restarts. Read-only by default. | 7–9 engineer-weeks |
| **v1** | A safe, proactive assistant | …let it do real work with approvals from the chat, schedule it, run it on local or cloud models, stop it, and serve more than one org. | 7–8 |
| **v2** | A team | …run several agents in group chats on several machines, with hierarchy and tasks. | 8–10 |
| **v3** | Autonomy | …let agents act within permissions, wake on webhooks, and approve routine calls with a decision model. | 7–8 |

Sizes are the sum of the work-package estimates in each release's pack, for one agent working alone; they are my judgement, not measured, and should be recalibrated after v0. They replace my first, coarser guesses (19–23 in total), which were too low: the packs include the
spikes, live runs, adversarial tests, migration and acceptance of every release. Together they come to about **29–35 engineer-weeks**; independent packages can run in parallel, and coding agents shorten the calendar (roughly by half, from the earlier estimate) but not the spikes.
Computer use (cua) is a further 2–3.

## v0: one agent in a chat

**Value.** From Anytype on a laptop or a phone, ask a Claude Code agent on your own machine about what is on that
machine (a repository, a folder of notes), and get the answer in the same chat, with nothing able to change your files.
It survives restarts without answering twice.

**Ships**

- One process, `anybot run`, containing the gateway, the Temporal worker and the node. The components are the same as in
  [ARCHITECTURE.md](ARCHITECTURE.md); they are only deployed together. Temporal is a local server with a persistent
  database file (`temporal server start-dev --db-filename …`, to be verified); a self-hosted or Cloud address is just
  configuration ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)).
- One backend, Anytype through `anytype serve` and one bot account that joined the space, behind the backend port
  ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md)): identity, chat, events, and reading the agent object.
- Schema, created by `anybot init`: `aa_settings` (the schema version only) and `aa_agent` with `aa_handle`,
  `aa_harness`, `aa_model`, `aa_chat` (the agent's own chat), `aa_workdir` (where the harness works, inside the node's
  allowed roots), `aa_approval_mode` (`read_only` or `full`), `aa_allowed_authors` and `aa_lifecycle` (`live` or `paused`). The agent's **instructions are the object's body**.
  The person-only fields are the ones in [ADR 0013](adr/0013-agent-permissions-over-the-org.md).
- One workflow per live `aa_agent`, on a small `AgentCore` of our own behind a seam
  ([ADR 0019](adr/0019-own-workflow-core-behind-a-seam.md), accepted, [Q20](OPEN-QUESTIONS.md); the harness from npm is reconsidered at v1
  and the seam keeps that cheap); one handler, `chat`. A turn: read the agent
  object fresh → 👀 on the message → run the harness → post the reply. Messages that arrive during a turn queue.
- Four harnesses, as registry entries ([Q17](OPEN-QUESTIONS.md), settled): **Claude Code** and **Grok Build** over
  ACP, **Codex** over its app-server (Michel's adapters, copied with provenance: Michel `packages/harness/adapters`), and
  **Mistral Vibe** as a headless CLI, `vibe -p` (a new adapter kind, [ADR 0020](adr/0020-harness-adapter-kinds.md),
  [research](research/mistral-vibe.md)). Each can run on a subscription login or an API key where it offers both
  ([Q19](OPEN-QUESTIONS.md), settled). `aa_harness` picks one per agent. In `read_only` every permission request is denied and
  the reply says so; `full` allows everything and only a person can set it. **`read_only` must hold even when the
  harness's own configuration would approve a call itself** (the harness's own read-only mode is used as well as the host's
  denial: Codex sandbox `read-only`, Grok `--sandbox read-only`, Claude Code in its asking mode with refusal, per Michel's
  `docs/research/sandbox-spike.md`; `fetch` is not read-only in v0), so each harness runs with a controlled home and
  configuration (Michel audit G247 for Claude Code, G172 for Grok, whose `~/.grok/config.toml` can answer a tool call
  before the host sees it), and the acceptance script proves it per harness. **Grok Build and Vibe ship only if their live check
  passes**: Michel has run it against a fake agent only (G172), and the official page names headless `-p` and "full ACP
  support" but not the ACP command or permission modes. If one does not pass, it moves to v1. Vibe's default agent auto-approves file edits, so its `read_only` run names the `ask` agent and a read-tool allowlist and uses a controlled `VIBE_HOME`.
- **Org-aware from the start** ([ADR 0018](adr/0018-one-or-more-orgs-per-deployment.md)): the configuration is a list of
  orgs, state and task queues are keyed by space; v0 is accepted with one org, v1 with two.
- **Owner only by default.** The agent answers messages from `aa_allowed_authors`; empty means the space owner. Anyone
  else is ignored. Without this, any space member could run commands on your machine.
- Loop guard (its own messages are never input), idempotent delivery by message id, and rotation of an idle workflow before
  its history gets long ([ADR 0011](adr/0011-event-gateway.md), decision 7).
- `anybot init`, `anybot agent create <handle>` (creates the object and its chat, or takes the id of a chat you
  made in the app), `anybot run`, and `anybot doctor` (Anytype key and scope, space joined, Temporal reachable,
  `claude` installed).

**Does not ship:** approvals, groups, @mentions, tasks, schedules, triggers, webhooks, more than one node,
the OpenAI-compatible harness and local-model endpoints, the decision model, permissions over the org, shared prompts, `/stop`.
(More than one `aa_agent` should work, since each is its own workflow; v0 tests one.)

**Done when** (an acceptance script, run twice from a clean space):

1. `anybot init`, `agent create` and `run` on a fresh space; a message from the owner in the agent's chat gets a reply.
2. A message from another member gets no reply and nothing runs.
3. For each harness installed on the node (Claude Code, Codex, and Grok Build if it ships): asked to create a file, the
   agent in `read_only` refuses and no file exists, **including with a harness configuration that tries to auto-approve**;
   switched to `full` by editing the object, it creates it.
4. Edit the object's body and the next turn follows it; set `aa_lifecycle` to `paused` and there is no reply.
5. `kill -9` the process mid-turn and restart: earlier messages are not answered again, and the interrupted one gets a
   "interrupted, send it again" notice.
6. With the rotation threshold lowered in a test, an agent rotates and keeps answering with its session intact.
7. `anybot doctor` names each failure it is meant to catch (key without write scope, space not joined, Temporal down,
   harness missing).

**Spikes first:** [002](SPIKES.md) live `anytype serve` (needs the `anytype-cli` binary and network access to a sync
network, or a self-hosted any-sync); [004](SPIKES.md) update-with-start from the gateway; [006](SPIKES.md) the
agent core on a Temporal server, with history events per message measured (ADR 0019); [007](SPIKES.md) the four harnesses (Vibe headless and, for later, `vibe-acp`), `read_only` with a hostile harness configuration;
[009](SPIKES.md) schema bootstrap for these two types. [016](../spikes/016-backend-port-any/) (the port) is done.

**Risks it retires:** that heart's v2 streams work in a headless `anytype serve`, that the npm harness and Temporal
pin holds up, that a turn is durable, and what the workflow core costs in history. **Known risks:** if the streams are disabled in the CLI build
(`StreamDisabled`, see [research](research/anytype-api.md)), the adapter polls the message list instead; the v2 route list has `POST /v2/spaces/{s}/chats`, but
what it accepts is unverified, and if it cannot create a chat the person creates it in the app. Both are decided by spike 002.

**Known risk, accepted by the owner ([Q19](OPEN-QUESTIONS.md): both logins and API keys):** Michel's [provider-terms research](https://github.com/Herklos/Michel/blob/main/docs/research/provider-terms.md)
rates driving a consumer Claude subscription from an orchestrator **high** risk, Codex and Grok **medium**, and says to
prefer API keys or the official login on the owner's own machine. Some subscriptions offer no API key, so both are supported;
`anybot init` shows the notice and `doctor` says which one each agent uses. Vibe documents only an API key, so for it the answer may be API key only.

**Settled by the owner:** [Q17](OPEN-QUESTIONS.md) (Claude Code, Codex, Grok Build and Vibe), [Q18](OPEN-QUESTIONS.md) (owner-only by default),
[Q19](OPEN-QUESTIONS.md) (logins and API keys) and [Q20](OPEN-QUESTIONS.md) (own core now, the harness reconsidered at v1).

## v1: a safe, proactive assistant

> Detailed build plan: [roadmap/v1/](roadmap/v1/README.md) (eight work packages).

**Value.** Let the agent do real work without giving it free rein, have it work while you are away, and run it on
the models you choose.

**Ships, in this order**

1. **Approvals** ([ADR 0008](adr/0008-approvals-objects-and-reactions.md)): `ask` mode. A risky tool call creates an
   `aa_approval` object and a chat message; ✅ or ❌ from an approver's own account decides; it expires and denies.
   `aa_settings.aa_approvers` is added. Decisions record who and when.
2. **Schedules**: `aa_schedule` (cron, timezone, enabled, deliver to the agent's chat) as Temporal Schedules,
   reconciled from Anytype. A schedule's turn posts to the chat.
3. **Model endpoints and the OpenAI-compatible harness** ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)):
   the loop against `llama-server` or a cloud API, with `aa_endpoint`: local models, and a harness that needs no CLI.
4. **More than one org** ([ADR 0018](adr/0018-one-or-more-orgs-per-deployment.md)): one deployment serving two spaces,
   with an agent in each; replies, cursors, queues and approvals do not cross, and an org whose backend is down does
   not stop the other.
5. **`/stop`**: the owner stops a running turn from the chat.
6. **Status and notices**: `anybot status`, a readable notice for every failed turn, usage in the notice.
7. **Variants by configuration only**: Temporal Cloud, and a self-hosted any-sync
   ([ADR 0012](adr/0012-any-anytype-sync-network.md)); the v0 acceptance script passes on both.

**Done when:** an `ask` agent asks for approval and acts only after ✅; a ❌, an expiry and an approval from a
non-approver each do the right thing; a weekday schedule posts; an agent on a llama-server model answers; `/stop`
ends a running turn; two spaces served by one deployment never mix; the v0 script passes on Temporal Cloud and on the self-hosted network.

**Spikes first:** the approval half of [006](SPIKES.md); [011](SPIKES.md) approver identity (a person, never an agent
account); the OpenAI-loop half of [007](SPIKES.md); [012](SPIKES.md); a two-org run of [004](SPIKES.md).

**Schema delta (additive):** `aa_approval`, `aa_schedule`; on `aa_agent` `aa_endpoint`, `aa_effort`; on `aa_settings`
`aa_approvers`. `aa_approval_mode` gains `ask`.

## v2: a team

> Detailed build plan: [roadmap/v2/](roadmap/v2/README.md) (eight work packages).

**Value.** More than one agent, working together in shared chats, on more than one machine.

**Ships, in this order**

1. **Groups and mentions**: `aa_group` (its chat, members, lead, routing `lead|mention`); @mentions between people and
   agents; the unaddressed message goes to the group's lead.
2. **Several agents** with hierarchy (`aa_reports_to`), shared prompts and rules (`aa_prompt`, `aa_rules`).
3. **Tasks**: `aa_task` with lead, assignee, reviewer and states; changes wake the people concerned
   (the `objectChanged` handler); results as objects linked from chat.
4. **Gateway and nodes apart**: one gateway, several nodes (`aa_node`, a task queue per node); an agent moves with an
   edit of `aa_node`.
5. **The three account setups** ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)): one shared bot account,
   several, one per agent, with identity resolution.
6. **Defaults for agents' own work**: `task.create` and `schedule.self` only
   ([ADR 0013](adr/0013-agent-permissions-over-the-org.md)).

**Done when** (the old v0 story): a person writes without a mention, the Primary answers and creates a task for the
chief, the chief assigns the specialist, the specialist works on another machine, asks one approval, delivers a result,
the task goes to `review` then `done`, and the answer is in chat, repeated with the three account setups.

**Spikes first:** [008](SPIKES.md) two nodes, one gateway; [011](SPIKES.md) in full; [010](SPIKES.md) and
[003](SPIKES.md) as needed for accounts.

## v3: autonomy and reach

> Detailed build plan: [roadmap/v3/](roadmap/v3/README.md) (six work packages).

**Value.** Agents that act on their own within limits, wake on the outside world, and ask a person only when needed.

**Ships, in this order**

1. **Org permissions** ([ADR 0013](adr/0013-agent-permissions-over-the-org.md), in full): `agent.create`,
   `agent.edit.*`, `schedule.reports`, `group.edit`, `trigger.self`, with the enforcement in three layers.
2. **Decision model** ([ADR 0015](adr/0015-decision-model-for-approvals.md)): `auto` mode with a local or cloud model
   that races a person and never fails open, with hard floors.
3. **Triggers**: webhooks (signed, with idempotency), `object_change`, `chat_pattern` ([ADR 0011](adr/0011-event-gateway.md)).
4. **Claims** in an opted-in group ([ADR 0006](adr/0006-coordination-hierarchy-with-opt-in-claims.md)).

**Done when:** the specialist in `auto` mode has a routine call approved by a local model in one run and a cloud model
in another, and a risky call escalated to a person; a GitHub push wakes the chief; an edit of a group by an agent
without `group.edit` is refused with a notice; two agents never take the same task.

**Spikes first:** [013](SPIKES.md) the permission table; [015](SPIKES.md) decision-model quality.

## After v3 (unordered; each needs the owner's go-ahead)

- Computer and desktop use through cua: sandboxes first ([ADR 0016](adr/0016-computer-use-with-cua.md), Q15; spike 014; +2–3 weeks).
- `backend-any`, when `any` leaves developer preview or Anytwo ships ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md),
  signals in [research/any-vs-anytype.md](research/any-vs-anytype.md)). It is driven by those signals, not by the
  release number, and may land before v3.
- Mid-turn steering and coalescing; verified work at an exact commit (Michel ADR 0019); memory, skills and logs as types
  (Q8); harness profiles with fallbacks; usage and cost written to Anytype.
- More gateway sources (email, RSS, a GitHub App); a high-availability gateway pair (Q12); avatars and profiles synced from `aa_agent`.
- Migration from the `anytype-agents` schema; a Hermes or Osaurus delegating harness if still useful.

**Much later**, weak adapters behind the backend port ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md)), which
lack capabilities and which anybot works without: a Starfish backend (to assess) and a Notion backend (no spike until
there is a stated need).

## Rules for every release

- It is usable on its own and its acceptance script passes from a clean space, twice.
- The schema changes only additively and is versioned; `anybot migrate` upgrades an existing space
  ([ADR 0009](adr/0009-new-minimal-versioned-schema.md)).
- Specs and ADRs are updated in the same change as the behaviour; every spike's README says what it did not prove.
- The conformance suite for the backend port is green ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md)).
- Nothing from a later release is started early to "save time" without the owner's say.

## Where the old v0 acceptance went

| Old point | Now |
| --- | --- |
| 1 `bootstrap` creates the schema | v0 (two types), the rest with the release that needs each |
| 2 two nodes, three account setups | v2 |
| 3 Primary, chief, specialist | v2 |
| 4 routing `lead`, task from a message | v2 |
| 5 assign, one approval, result, review | approvals v1, the flow v2 |
| 6 a weekday schedule | v1 |
| 7 a webhook trigger | v3 |
| 8 crash safety | v0, and in every release |
| 9 Temporal Cloud, self-hosted any-sync | v1 |
| 10 a local model on `llama-server` | v1 |
| 11 `auto` with a decision model | v3 |
| 12 `schedule.self`, refused group edit | `schedule.self` v2, the refusal v3 |
