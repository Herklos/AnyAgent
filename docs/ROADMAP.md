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

Order: spikes 002 → 004 → 006 → 007 → 009 → 008 ([SPIKES.md](SPIKES.md)).

## After v0 (unordered)

- Per-agent avatars and profiles synced from `aa_agent` onto exclusive accounts.
- Claims in a group; an `auto` router model for unaddressed messages.
- Harness profiles with fallbacks (Michel ADR 0018); usage and cost written to Anytype.
- Memory, skills, logs and suggestions as types (from the `anytype-agents` skill).
- Verified work: a gate command at an exact commit, landing on a branch (Michel ADR 0019).
- More gateway sources (email, RSS, GitHub App); HA gateway pair.
- Migration from the `anytype-agents` schema; a Hermes/Osaurus delegating harness if still useful.
