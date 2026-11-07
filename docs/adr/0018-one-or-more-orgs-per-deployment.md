# ADR 0018: A deployment serves one or more orgs

- Status: accepted (owner's direction, 2026-11-07: "consider it can use 1 or more anytype/anytwo orgs/spaces, if it makes
  sense"; the analysis below says it does)
- Date: 2026-11-07

## Context

Until now the documents assumed one space per deployment ([ARCHITECTURE.md](../ARCHITECTURE.md) section 10). People
have more than one space: a personal one, a work one, a community one, and later spaces on Anytwo
([ADR 0017](0017-anytype-backend-behind-a-port.md)). Running a second anyagent for each means a second Temporal, a second
gateway and a second set of nodes for what is one person's team of machines.

An **org** is one space on one backend: the unit that holds agents, groups, schedules, tasks and approvals
([ADR 0002](0002-anytype-is-the-source-of-truth.md)).

## Decision

1. **One deployment, one or more orgs.** The configuration holds a list of orgs. Each has an id (a label for logs and
   the CLI), a backend (`anytype` now, `any` later), the backend's endpoint and keys, and a space id. Orgs may be on
   different backends and different sync networks ([ADR 0012](0012-any-anytype-sync-network.md)); the rule "one backend
   per org" ([ADR 0017](0017-anytype-backend-behind-a-port.md)) is unchanged. One `anytype serve` process, which is one
   account, may serve several orgs when that account is a member of several spaces.
2. **An agent belongs to exactly one org**, the one whose space holds its `aa_agent`. Agents never read or write another
   org, and nothing links objects across orgs.
3. **Everything that is keyed by space stays keyed by space, and nothing is keyed by the org label:**
   - workflow id `agent:<spaceId>:<agentObjectId>` and schedule id `schedule:<spaceId>:<scheduleObjectId>` are unchanged
     (space ids are unique, so the ids cannot collide across orgs);
   - gateway cursors, delivered-key sets and loop-guard counts are keyed by space id;
   - **the node task queue becomes `node:<spaceId>:<handle>`** (it was `node:<handle>`). A node handle is unique inside
     an org, not across orgs: two orgs can each have a node called `mac-studio` on different machines, and with the old
     name both would poll one queue and run each other's turns.
4. **Failure isolation.** The gateway runs one supervisor per org: its streams, cursor, reconcile and backoff. An org whose
   backend is down or whose key is revoked stops waking its own agents and nothing else. `anyagent doctor` reports per
   org.
5. **Each org is a trust boundary, and a node is not.** A node lists the orgs it serves (`serves: [orgId, …]`, by
   default one). Every activity checks that the org of its work is on that list. But a node runs all its harnesses as
   one operating-system user, so two orgs on one node share that machine's files and logins: the owners of both orgs
   must trust the node. Where they should not, use separate nodes, or separate users or containers (not built).
   Secrets stay per org and per node ([AGENTS.md](../../AGENTS.md) rule 3).
6. **Schema, approvers, permissions and rules are per org** (`aa_settings` is one per space), as already specified.
7. **Delivery.** Configuration and state are org-aware from v0, so nothing needs migrating. The acceptance test with two
   orgs (and a check that nothing crosses between them) is in v1 ([ROADMAP.md](../ROADMAP.md)); v0 tests one org.

## Consequences

- A little more configuration, and an `org` argument through the gateway, activities and CLI.
- One Temporal serves all orgs. A Temporal namespace per org is still possible later
  ([ADR 0003](0003-one-shared-temporal-one-workflow-per-agent.md)).
- Two anyagent deployments must not serve the same space against the same Temporal namespace: they would both wake the
  agents. `anyagent doctor` looks for a workflow's other starter and warns.
- Mixed backends, such as one Anytype org and one Anytwo org, need nothing beyond the adapters.

## Extension points

- The org list is data. A new backend is a new `backend` value with an adapter and the conformance suite.
- Per-org Temporal namespaces and per-org operating-system users on a node are possible later without changing ids.

## Not generalised

- No object, agent, task or message crosses orgs; no org-to-org delegation.
- No automatic sharing of a node between mutually distrusting orgs.
