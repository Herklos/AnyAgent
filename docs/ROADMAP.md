# Roadmap

## v0: a small team over two nodes

Chosen by the owner (2026-11-06). Done when, in one Anytype space:

1. `anyagent bootstrap` creates the `aa_*` schema and Queries ([schema.md](specs/schema.md)).
2. Two nodes (for example a Mac and a Linux box) run anyagent nodes; one event gateway and one Temporal run next to
   each other. The run is repeated with the three account setups: one bot account for all agents, two shared accounts,
   and one account per agent ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)).
3. Three agents: a **Primary** (lead of the team group), a **chief** and a **specialist** (Claude Code), placed on the
   two nodes.
4. A person writes in the group chat without a mention → the Primary answers (routing `lead`) and creates an `aa_task`
   linked to the message, lead = chief.
5. The chief assigns the specialist (hierarchy) and @mentions them; the specialist works, asks for one approval (✅ by
   the person from their own Anytype account), finishes, writes `aa_result`, moves the task to `review`; the chief
   moves it to `done`; the reply appears in chat.
6. One `aa_schedule` (a weekday brief) fires and posts to the group.
7. One `webhook` trigger (for example a GitHub push) reaches the gateway and wakes the chief.
8. Killing a node, the gateway or the Temporal worker mid-turn loses nothing that was already in Anytype, and the
   turn resumes or reruns.
9. The same slice runs, by configuration only, with Temporal self-hosted and Temporal Cloud, and on Anytype's network
   and a self-hosted any-sync ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md),
   [ADR 0012](adr/0012-any-anytype-sync-network.md)).
10. One agent runs on a local model through `llama-server` ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)).
11. The specialist runs in `auto` mode: a decision model (local in one run, cloud in another) approves a routine call
    and escalates a risky one to the person ([ADR 0015](adr/0015-decision-model-for-approvals.md)).
12. The chief creates its own `aa_schedule` (`schedule.self`); an edit of a group by an agent without `group.edit` is
    refused with a notice ([ADR 0013](adr/0013-agent-permissions-over-the-org.md)).

Order: spikes 002 → 004 → 006 → 007 → 009 → 011 → 013 → 008, then 012, 015 and 016 ([SPIKES.md](SPIKES.md)).

## After v0 (unordered)

- Per-agent avatars and profiles synced from `aa_agent` onto exclusive accounts.
- Computer and desktop use through cua: sandboxes first, then a node's own desktop (opt-in) ([ADR 0016](adr/0016-computer-use-with-cua.md), Q15).
- Claims in a group; an `auto` router model for unaddressed messages.
- Harness profiles with fallbacks (Michel ADR 0018); usage and cost written to Anytype.
- Memory, skills, logs and suggestions as types (from the `anytype-agents` skill).
- Verified work: a gate command at an exact commit, landing on a branch (Michel ADR 0019).
- More gateway sources (email, RSS, GitHub App); HA gateway pair.
- Migration from the `anytype-agents` schema; a Hermes/Osaurus delegating harness if still useful.
- `backend-any` once `any` leaves developer preview or Anytwo ships ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md), signals in [research/any-vs-anytype.md](research/any-vs-anytype.md)).

## Much later

Weak adapters behind the backend port ([ADR 0017](adr/0017-anytype-backend-behind-a-port.md)): they lack capabilities
(live streams, resume cursors, reactions), and anyagent works without them.

- A Starfish backend (to assess).
- A Notion backend. No spike until there is a stated need.
