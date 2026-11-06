# ADR 0001: anyagent is its own runtime

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

Today the org of agents lives in Anytype (`anytype-agents` skill, v1.59.0) and is applied by hand into runtimes:
Hermes profiles (`hermes-profiles` v1.46.0) and Osaurus agents (`osaurus-agents` v1.5.2). The skills repo README states
the cost: "Editing Anytype does not push configs; apply with `hermes-profiles` after an accepted suggestion or when the
user asks." Each runtime also brings its own limits, for example Hermes Bot Mode rooms of 2–6 bots
(`hermes-profiles/references/messaging-groups.md`), which forced HQ Groups to be split into Subteam Groups.

Three options were considered: anyagent as its own runtime; anyagent as a conductor that only bridges Anytype to
existing runtimes and automates the apply step; or both.

## Decision

anyagent is **its own runtime**. It runs the agent loop itself on each node, drives CLI harnesses and model APIs through
adapters, and reads Anytype live. There is no apply step.

## Consequences

- An edited agent, prompt or schedule object takes effect at the next turn boundary.
- Hermes and Osaurus are not required. Room size, routing and scheduling follow anyagent's own rules.
- anyagent must provide what those runtimes gave: harness drivers, sessions, approvals, schedules. Most of it comes
  from Michel ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)) and Temporal ([ADR 0003](0003-one-shared-temporal-one-workflow-per-agent.md)).
- Features Hermes has and anyagent does not yet (voice, Cua computer use, browser profiles, curated memory) are out of
  v0.

## Extension points

- A delegating harness kind (`runtime: hermes` / `osaurus`) can be added later as an adapter that hands an agent's turns
  to an existing runtime. It is not planned for v0.

## Not generalised

- No adapter for Hermes or Osaurus in v0.
