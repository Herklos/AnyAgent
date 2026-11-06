# ADR 0003: One shared Temporal; exactly one workflow per agent

- Status: accepted (owner, 2026-11-06). Amended 2026-11-06: self-hosted and Temporal Cloud are both supported (owner,
  answer to Q2); runs start with update-with-start and are rotated, not continued as new ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)).
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

1. One Temporal serves every node of a deployment. Each node is a Temporal worker on its own task queue `node:<handle>`.
2. **Self-hosted or Temporal Cloud, by configuration only.** The gateway and every node read the same connection
   block: `temporal: {address, namespace, tls?: {cert, key, ca}, apiKeyEnv?}`. Self-hosted means the dev server or a
   cluster on a private network such as Tailscale. Temporal Cloud uses mTLS or an API key (the TypeScript connection
   takes `apiKey`, `@temporalio/client` 1.24.0 `lib/connection.d.ts`, line 100). No code path depends on which one is
   used. anyagent uses only features both offer: workflow updates, update-with-start, queries, signals and Schedules.
   The minimum self-hosted server version is still unverified (spike 004).
3. Each `aa_agent` is exactly one workflow with id `agent:<spaceId>:<agentObjectId>`. The event gateway
   ([ADR 0011](0011-event-gateway.md)) starts it with **update-with-start** when it has the first event for it. While
   the run is idle, the gateway **rotates** it to a fresh run under the same id
   ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)). "Exactly one workflow" means one workflow id with
   at most one open run.
4. Everything that wakes an agent is an update (or, for close, a signal) to that workflow: chat messages, object
   changes, schedule fires, trigger fires, approval decisions and claims. The contract is in
   [specs/agent-workflow.md](../specs/agent-workflow.md).
5. `aa_schedule` objects become Temporal Schedules whose action wakes the owner's workflow.

## Consequences

- Durable turns, timers and approvals survive node crashes and restarts.
- A central dependency exists. If Temporal is down, agents stop; Anytype and its data are unaffected
  ([ADR 0002](0002-anytype-is-the-source-of-truth.md)).
- Nodes need network reach to Temporal (gRPC 7233 self-hosted, or the Cloud endpoint) and to the `anytype serve` of
  their agents' accounts.
- Moving between self-hosted and Cloud loses execution history only; `anyagent rebuild` recreates the workflows and
  schedules from Anytype ([ADR 0002](0002-anytype-is-the-source-of-truth.md)).
- A Raspberry Pi node runs only a worker, not a Temporal server.

## Extension points

- Namespaces: one Temporal namespace per space is possible later (Michel ADR 0009 did the same).
- The workflow contract does not depend on where Temporal runs, so a per-node Temporal remains possible.

## Not generalised

- No embedded actor runtime. No multi-cluster.
