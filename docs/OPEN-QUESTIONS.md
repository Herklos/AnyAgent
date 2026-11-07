# Open questions

Each is the owner's to settle. When one is decided, move it into an ADR and list it under "Settled". Numbers are never
reused.

| # | Question | Default until decided | Notes |
| --- | --- | --- | --- |
| Q5 | Do object discussions (comments) wake agents like chat messages do? | no (v0) | The existing org uses item comments for item-scoped dialogue |
| Q6 | Is a space the privacy boundary (every member can read every chat)? | assumed yes | If chats can be private, groups could be too |
| Q7 | Is `expected_etag` on PATCH checked only against the local copy? | assumed yes | Decides whether Anytype alone can ever serialise anything |
| Q8 | Memory, skills, logs and suggestions: which first, and in which form? | none in v0 | All exist in the `anytype-agents` skill |
| Q9 | Share Michel's adapters as a published package instead of copying them? | copy with provenance | [research/michel-reuse.md](research/michel-reuse.md) |
| Q11 | Package and binary names: `anyagent` CLI, `@anyagent/*` packages? | as written | |
| Q12 | Gateway high availability: one instance, or two in parallel from the start? | one | Idempotency keys already make double delivery harmless ([ADR 0011](adr/0011-event-gateway.md)) |
| Q13 | Agent replies: one final message, or a "working…" message edited as the turn streams? | one final message | Editing costs writes and sync traffic |
| Q14 | Report upstream to `temporal-community/temporal-agent-harness`: 0.3.1 fails to import with Temporal SDK 1.25 (deep import of `@temporalio/common/lib/time.js`), and propose continue-as-new for the TypeScript agent workflow? | not reported; anyagent pins SDK 1.24.0 and rotates runs | [research/temporal-agent-harness.md](research/temporal-agent-harness.md). Posting to an outside repository is the owner's call |
| Q15 | Computer use: which comes first after v0, cua sandboxes (Linux container, macOS VM) or cua-driver on a node's own desktop? | sandboxes first | [ADR 0016](adr/0016-computer-use-with-cua.md); Michel's plan also puts containers first |
| Q16 | Backend: Anytype (anytype-heart) only, `any`/Anytwo only, or Anytype now behind a port with `any` planned as the second backend? | Anytype behind a port (C) | [ADR 0017](adr/0017-anytype-backend-behind-a-port.md) (proposed); evidence in [research/any-vs-anytype.md](research/any-vs-anytype.md) |

## Settled

| # | Decision | Where |
| --- | --- | --- |
| Q1 | Keys are prefixed `aa_` | [ADR 0009](adr/0009-new-minimal-versioned-schema.md) |
| Q2 | Temporal self-hosted or Temporal Cloud, by configuration | [ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md) |
| Q3 | Anytype's network or a self-hosted any-sync, by configuration | [ADR 0012](adr/0012-any-anytype-sync-network.md) |
| Q4 | Agents change the org according to their permissions | [ADR 0013](adr/0013-agent-permissions-over-the-org.md) |
| Q10 | Depend on temporal-agent-harness from npm, not vendored | [ADR 0010](adr/0010-reuse-michel-adapters-and-the-npm-harness.md) |
