# Architecture decision records

Each ADR has Context, Decision, Consequences, **Extension points** and **Not generalised**. Change an ADR in the same
commit as the behaviour it decides.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-anybot-is-its-own-runtime.md) | anybot is its own runtime (no apply step into Hermes/Osaurus) | accepted |
| [0002](0002-anytype-is-the-source-of-truth.md) | Anytype is the source of truth and the bus; Temporal holds execution only | accepted |
| [0003](0003-one-shared-temporal-one-workflow-per-agent.md) | One shared Temporal; exactly one workflow per agent | accepted |
| [0004](0004-typescript-over-the-http-api.md) | TypeScript, over the Anytype HTTP/SSE API (heart not embedded) | accepted |
| [0005](0005-identity-agents-map-to-accounts.md) | Agents map to Anytype accounts by data: one shared, a pool, or one each | accepted |
| [0006](0006-coordination-hierarchy-with-opt-in-claims.md) | Hierarchy assigns; groups may opt into claims serialised by Temporal | accepted |
| [0007](0007-chat-for-talk-objects-for-work.md) | Chat for talk, objects for work | accepted |
| [0008](0008-approvals-objects-and-reactions.md) | Approvals are objects decided by an approver's reaction or edit | accepted |
| [0009](0009-new-minimal-versioned-schema.md) | New minimal, versioned schema with `aa_` keys | accepted |
| [0010](0010-reuse-michel-adapters-and-the-npm-harness.md) | Reuse Michel's adapters; build the workflow on temporal-agent-harness from npm (pinned, not vendored) | accepted |
| [0011](0011-event-gateway.md) | An event gateway forwards Anytype and webhook events to workflows | accepted |
| [0012](0012-any-anytype-sync-network.md) | Anytype's network or a self-hosted any-sync, by configuration only | accepted |
| [0013](0013-agent-permissions-over-the-org.md) | Agents may change the org according to their permissions | accepted |
| [0014](0014-model-endpoints-local-and-cloud.md) | Model endpoints: llama.cpp and any OpenAI-compatible API, local or cloud | accepted |
| [0015](0015-decision-model-for-approvals.md) | A decision model judges `auto` approvals, racing a person, never failing open | accepted |
| [0016](0016-computer-use-with-cua.md) | Desktop and computer use through cua | accepted as a plan (after v0) |
| [0017](0017-anytype-backend-behind-a-port.md) | Anytype (anytype-heart) behind a backend port; `any` planned as the second backend; others far later | accepted |
| [0018](0018-one-or-more-orgs-per-deployment.md) | A deployment serves one or more orgs (spaces, on Anytype or later Anytwo) | accepted |
| [0019](0019-own-workflow-core-behind-a-seam.md) | Own the small workflow core behind a seam; decide on the harness at v1; no agent framework | accepted |
| [0020](0020-harness-adapter-kinds.md) | Harness adapter kinds: ACP, app-server and headless CLI; Mistral Vibe in v0; both login and API-key auth | accepted |
