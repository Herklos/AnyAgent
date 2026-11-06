# ADR 0005: Identity: one Anytype account per node now, per agent later

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

From the anytype-cli README: the headless server "requires a dedicated bot account, which you create using
`anytype auth create`"; a bot account "only has access to spaces it explicitly joins"; API keys are limited to chosen
spaces and to read-only or read-write ("there is no default"). One `anytype serve` process is logged in to one account.
A chat message's author is that account.

One account per agent gives each agent its own author, avatar, role and revocation, at the cost of one Anytype process
per agent. One account per node is cheap but lets agents on a node impersonate each other. The owner chose **per node
now, per agent later**.

## Decision

1. v0: each node has **one bot account** and one `anytype serve`. The `aa_node` object records its participant id.
2. An agent's message is posted by its node's account with a **handle tag**, and the `aa_agent` handle is resolved from
   the tag. The tag format is a short first line, `**@handle**`, so people see who speaks.
3. Code never assumes the tag: an `Identity` port answers "who wrote this message" and "post as this agent". v0 has the
   node-account implementation; the per-agent implementation (one account and `anytype serve` per agent, separate
   listen addresses) is the planned second.

## Consequences

- Trust boundary is the node: agents on one node can technically post as each other. Agents on different nodes cannot,
  because Anytype signs each change with its author's key.
- Authority checks (approvals, `allowed_authors`) use participant ids, never tags.
- Process cost of per-agent accounts is unmeasured ([SPIKES.md](../SPIKES.md) 003); it decides when to switch.

## Extension points

- `Identity` port with two implementations (one shipped, one planned).

## Not generalised

- No per-agent keys or signatures inside the message text.
