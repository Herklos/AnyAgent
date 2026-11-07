# ADR 0011: An event gateway forwards Anytype and external events to agent workflows

- Status: accepted (owner's proposal, 2026-11-06); placement and HA details open (Q12). Amended 2026-11-06:
  update-with-start, loop guard and rotation ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)).
- Date: 2026-11-06

## Context

The first architecture draft had every node subscribe to the space's streams and forward only events for its own
agents, plus a webhook listener on some node. That multiplies subscribers and cursors, scatters webhook verification, and
leaves no obvious owner for the schedule reconciler. The owner proposed "a kind of event handler server that catches
events from both Anytype SSE and external webhooks and forward them to the corresponding agent workflow".

## Decision

A dedicated **event gateway** process (`apps/gateway`) is the only path from the outside world into agent workflows.

1. **Sources** (each a registered source kind):
   - Anytype chat: `GET /v2/spaces/{s}/chats/stream` for discovery, plus one resumable
     `GET /v2/spaces/{s}/chats/{c}/messages/stream` per chat bound to an `aa_group`.
   - Anytype objects: `POST /v2/spaces/{s}/search/stream` over the `aa_*` types.
   - Webhooks: `POST /hooks/{triggerId}` with an HMAC signature, verified with a secret held in the gateway's config.
2. **Pipeline** per event: normalise → dedupe (idempotency key) → route (which agents does this concern, using a cache of
   `aa_agent` / `aa_group` / `aa_trigger` built from the object stream) → **update-with-start** the agent workflow(s)
   (the harness's message update naming the event's handler; `updateId` = the idempotency key;
   `workflowIdConflictPolicy: USE_EXISTING`; `waitForStage: ACCEPTED`) → commit the source cursor. The cursor is
   committed once the update is **accepted**, not completed, because completion means the turn has ended. Acceptance is confirmed by awaiting the update handle's result (the admit handler returns at once); the start call at `ACCEPTED` alone does not surface a validator rejection, so a message sent to a closing workflow would otherwise be marked delivered and lost (reproduced in review of the v0 WP5 implementation). A crash
   re-delivers. Temporal drops a repeated `updateId` within a run (to be verified, spike 004), and the gateway's own
   key store drops it across runs.
3. **Reconciler**: the gateway also turns `aa_schedule` objects into Temporal Schedules and keeps `aa_next_run` /
   `aa_last_run` up to date (through a node activity, since the gateway does not write to Anytype, see 4).
4. **Least privilege**: the gateway reads with a **read-only** API key, on its own **viewer** account (recommended) or on
   one of the agent accounts ([ADR 0005](0005-identity-agents-map-to-accounts.md), decision 6). It never writes to Anytype. All writes stay on nodes, as their agents ([ADR 0005](0005-identity-agents-map-to-accounts.md)).
5. **State**: cursors (chat state ids, webhook delivery ids) and recently delivered keys (7 days) in a local SQLite
   file. Losing it can re-deliver events newer than the last committed cursor, at most once per event and run.
6. **Loop guard**: the gateway sees every message of a group's chat in order, so it counts agent-authored messages since
   the last human message per chat and stops routing at `aa_max_hops`, with a notice posted by a node. The count can be
   rebuilt from the chat, so it does not depend on any one workflow run.
7. **Rotation** ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)): when a run reports
   `continueAsNewSuggested` or nears the update limit and its status is idle, the gateway sends the harness close
   signal. Updates rejected with `AgentClosed` during the close are retried with update-with-start once the run has
   ended. A run with a turn in flight is never closed.
8. **Placement**: next to Temporal (same private network); the webhook endpoint is the only port exposed beyond it.

## Consequences

- Nodes no longer open streams; they run a Temporal worker and harness adapters, and write through their agents'
  account endpoints.
- One subscriber per space: no duplicate signals, one place to observe lag (`event age at signal` metric).
- A second central component. While it is down nothing wakes: chat resumes from `Last-Event-ID`; the object stream has
  no replay, so the gateway diffs the new snapshot against its cache (`last_modified_date`) to emit missed changes;
  webhooks are lost unless the sender retries (most do; the gateway answers `202` only after the update is accepted).
- The gateway needs read access to every chat it routes, so it must be a member of the space.

## Extension points

- **Source kinds**: `anytype_chat`, `anytype_objects`, `webhook` in v0; later e.g. email (IMAP idle), RSS, a GitHub
  App, each a registry entry `{kind, connect, normalise, key}`.
- **Routing rules** are data on `aa_group` and `aa_trigger`, not code.
- **HA**: two gateways can run in parallel later; idempotency keys already make double delivery harmless.

## Not generalised

- No event store or replay log of its own (Anytype and Temporal histories are the record).
- No transformation language for payloads beyond the trigger's prompt template.
