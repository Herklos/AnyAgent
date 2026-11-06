# ADR 0003: One shared Temporal; exactly one workflow per agent

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

The owner's model of an agent: "Each agent has exactly 1 workflow running and can have cron schedules and be
signaled/updated by other workflows or external event triggers (webhook or whatever)." That is Temporal's entity
workflow pattern. Three placements were considered: an embedded actor loop per node with Anytype as the bus (fully
p2p); Temporal on each node; one shared Temporal. The owner chose **one shared Temporal**.

Anytype alone cannot serialise decisions across machines: any-sync merges concurrent edits, and the API's
`expected_etag` check runs against the local copy only (inferred from the p2p design; see
[OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md) Q7). A shared Temporal provides the serialisation that claims need.

## Decision

1. One Temporal cluster serves every node of a deployment (self-hosted over a private network such as Tailscale, or
   Temporal Cloud). Each node is a Temporal worker on its own task queue `node:<handle>`.
2. Each `aa_agent` is exactly one workflow with id `agent:<spaceId>:<agentObjectId>`, started with `signalWithStart`
   by the event gateway ([ADR 0011](0011-event-gateway.md)) when it has the first event for it, and kept alive with `continueAsNew`.
3. Everything that wakes an agent is a signal or an update to that workflow: chat messages, object changes, schedule
   fires, trigger fires, approval decisions, claims. The contract is in [specs/agent-workflow.md](../specs/agent-workflow.md).
4. `aa_schedule` objects become Temporal Schedules whose action signals the owner's workflow.

## Consequences

- Durable turns, timers and approvals survive node crashes and restarts.
- A central dependency exists. If Temporal is down, agents stop; Anytype and its data are unaffected
  ([ADR 0002](0002-anytype-is-the-source-of-truth.md)).
- Nodes need network reach to Temporal (gRPC 7233) and to nothing else besides their local `anytype serve`.
- A Raspberry Pi node runs only a worker, not a Temporal server.

## Extension points

- Namespaces: one Temporal namespace per space is possible later (Michel ADR 0009 did the same).
- The workflow contract does not depend on where Temporal runs, so a per-node Temporal remains possible.

## Not generalised

- No embedded actor runtime. No multi-cluster.
