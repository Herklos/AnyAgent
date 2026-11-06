# Architecture decision records

Each ADR has Context, Decision, Consequences, **Extension points** and **Not generalised**. Change an ADR in the same
commit as the behaviour it decides.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-anyagent-is-its-own-runtime.md) | anyagent is its own runtime (no apply step into Hermes/Osaurus) | accepted |
| [0002](0002-anytype-is-the-source-of-truth.md) | Anytype is the source of truth and the bus; Temporal holds execution only | accepted |
| [0003](0003-one-shared-temporal-one-workflow-per-agent.md) | One shared Temporal; exactly one workflow per agent | accepted |
| [0004](0004-typescript-over-the-http-api.md) | TypeScript, over the Anytype HTTP/SSE API (heart not embedded) | accepted |
| [0005](0005-identity-agents-map-to-accounts.md) | Agents map to Anytype accounts by data: one shared, a pool, or one each | accepted |
| [0006](0006-coordination-hierarchy-with-opt-in-claims.md) | Hierarchy assigns; groups may opt into claims serialised by Temporal | accepted |
| [0007](0007-chat-for-talk-objects-for-work.md) | Chat for talk, objects for work | accepted |
| [0008](0008-approvals-objects-and-reactions.md) | Approvals are objects decided by an approver's reaction or edit | accepted |
| [0009](0009-new-minimal-versioned-schema.md) | New minimal, versioned schema with `aa_` keys | accepted (prefix: Q1) |
| [0010](0010-reuse-michel-adapters-own-the-workflow.md) | Reuse Michel's adapters; own the workflow, no temporal-agent-harness | **proposed** |
| [0011](0011-event-gateway.md) | An event gateway forwards Anytype and webhook events to workflows | accepted |
