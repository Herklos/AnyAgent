# ADR 0002: Anytype is the source of truth and the bus; Temporal holds execution only

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

The owner wants anybot to "completely rely on Anytype" to run decentralised agents, with Anytype specifying workflows,
schedules and the rest. The owner also chose one shared Temporal for durable execution
([ADR 0003](0003-one-shared-temporal-one-workflow-per-agent.md)). Two stores invite drift: which one wins?

## Decision

1. **Anytype holds everything about the org and the work**: agents, groups, prompts, schedules, triggers, tasks,
   approvals, results and the conversation.
2. **Temporal holds execution state only**: workflow histories, pending signals, timers, Temporal Schedules derived from
   `aa_schedule` objects, in-flight turns and harness session ids.
3. **Every cross-agent message goes through Anytype first** (a chat message or an object), and the event gateway ([ADR 0011](0011-event-gateway.md)) turns it into a
   Temporal signal. The single exception is a claim ([ADR 0006](0006-coordination-hierarchy-with-opt-in-claims.md)),
   whose outcome is written to Anytype immediately.
4. **Rebuild is a supported operation**: from an empty Temporal, `anybot rebuild` starts one workflow per live
   `aa_agent` and reconciles every `aa_schedule`. Lost: in-flight turns and session ids (agents start fresh sessions).

## Consequences

- A person can see and fix everything from Anytype; nothing about the org hides in Temporal.
- Reads of configuration happen at each turn boundary (a few API calls per turn).
- Temporal-derived data written back to Anytype (`next_run`, `last_run`, task status) is a projection: the object is
  authoritative for intent (cron, enabled), Temporal for fact (when it fired).

## Extension points

- The `AnytypeClient` port isolates the API so a second implementation (embedded heart) can replace HTTP.

## Not generalised

- No second source of truth (no SQLite or git store of the org on nodes). Nodes keep only cursors and caches.
