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
| Q12 | Gateway high availability: one instance, or two in parallel from the start? | one | Idempotency keys already make double delivery harmless ([ADR 0011](adr/0011-event-gateway.md)) |
| Q13 | Agent replies: one final message, or a "working…" message edited as the turn streams? | one final message | Editing costs writes and sync traffic |
| Q14 | Report upstream to `temporal-community/temporal-agent-harness`: 0.3.1 fails to import with Temporal SDK 1.25 (deep import of `@temporalio/common/lib/time.js`), and propose continue-as-new for the TypeScript agent workflow? | not reported; anybot pins SDK 1.24.0 and rotates runs | [research/temporal-agent-harness.md](research/temporal-agent-harness.md). Posting to an outside repository is the owner's call |
| Q15 | Computer use: which comes first after v0, cua sandboxes (Linux container, macOS VM) or cua-driver on a node's own desktop? | sandboxes first | [ADR 0016](adr/0016-computer-use-with-cua.md); Michel's plan also puts containers first |

## Facts recorded (not decisions)

| Fact | Source |
| --- | --- |
| WP8 automated suite (fakes) PASS; live Anytype / spike 002 / spike 004 Cloud / live harness matrices **NOT RUN** in the cloud agent environment | [v0 REPORT](roadmap/v0/REPORT.md) (2026-11-07) |
| Own AgentCore ~11.18 history events / ~4.9 KB per message (50 msgs) — input for ADR 0019 v1 harness decision | WP3 spike 006 / REPORT |
| Claude Code and Codex are **not live-shipped** until a live PASS row exists; Grok + Vibe remain `shipping: v1` | REPORT + WP4 STATUS |
| v1 WP1 recommends **own approval gate** (ADR 0021 proposed); criteria 1/2/5 failed on `@temporalio/agent-harness@0.4.0`; pin stays 1.24.0 until owner accepts ADR / pin move | [ADR 0021](adr/0021-approval-gate-implementation.md), `scripts/harness-criteria.mjs --latest` |

## Settled

| # | Decision | Where |
| --- | --- | --- |
| Q1 | Keys are prefixed `aa_` | [ADR 0009](adr/0009-new-minimal-versioned-schema.md) |
| Q2 | Temporal self-hosted or Temporal Cloud, by configuration | [ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md) |
| Q3 | Anytype's network or a self-hosted any-sync, by configuration | [ADR 0012](adr/0012-any-anytype-sync-network.md) |
| Q4 | Agents change the org according to their permissions | [ADR 0013](adr/0013-agent-permissions-over-the-org.md) |
| Q10 | Depend on temporal-agent-harness from npm, not vendored | [ADR 0010](adr/0010-reuse-michel-adapters-and-the-npm-harness.md) |
| Q11 | The product is **AnyBot** (renamed from anyagent): CLI `anybot`, packages `@anybot/*`, env vars `ANYBOT_*`, workflow type `AnyBot`. The GitHub repository is still `Herklos/anyagent` until the owner renames it. The `aa_` schema prefix stays (Q1, settled) | this commit, [README](../README.md) |
| Q16 | Anytype now behind a backend port, `any` as the second backend; Starfish and Notion far later as weak adapters | [ADR 0017](adr/0017-anytype-backend-behind-a-port.md) |
| Q17 | v0 ships Claude Code, Codex, Grok Build and Mistral Vibe; Grok Build and Vibe only if their live check passes | [ROADMAP.md](ROADMAP.md), [ADR 0020](adr/0020-harness-adapter-kinds.md) |
| Q18 | An agent answers only the space owner by default (`aa_allowed_authors` empty = owner) | [ROADMAP.md](ROADMAP.md), [ADR 0013](adr/0013-agent-permissions-over-the-org.md) |
| Q19 | Both subscription logins and API keys, per agent, where the harness offers both (some subscriptions give no way to create an API key); `init` shows a terms notice; the person signs the harness in beforehand | [ADR 0020](adr/0020-harness-adapter-kinds.md), [ROADMAP.md](ROADMAP.md) |
| Q20 | Write the small workflow core ourselves behind an `AgentCore` seam and decide on `@temporalio/agent-harness` at v1 against stated criteria; no agent framework | [ADR 0019](adr/0019-own-workflow-core-behind-a-seam.md) |
