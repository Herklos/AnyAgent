# Open questions

Each is the owner's to settle. When one is decided, move it into an ADR and delete it here.

| # | Question | Default until decided | Notes |
| --- | --- | --- | --- |
| Q1 | Prefix type and property keys with `aa_`? | `aa_` | Avoids clashes with Anytype's built-in `task` and the skill's `agent`, `group`, `schedule` ([ADR 0009](adr/0009-new-minimal-versioned-schema.md)) |
| Q2 | Where does Temporal run for you: self-hosted on one of your machines over Tailscale, or Temporal Cloud? | self-hosted dev server for v0 | Affects the gateway's placement too |
| Q3 | Which Anytype sync network: Anytype's own, or a self-hosted any-sync? | Anytype's network | Self-hosting makes the whole stack yours; heart's licence names "Allowed Networks" |
| Q4 | Are agents allowed to create, edit or archive `aa_agent`, `aa_group`, `aa_schedule` objects (an org that edits itself), or only people? | agents may create `aa_task` and `aa_schedule` for themselves; only people edit agents and groups | The existing org uses `suggestion` objects for this |
| Q5 | Do object discussions (comments) wake agents like chat messages do? | no (v0) | The existing org uses item comments for item-scoped dialogue |
| Q6 | Is a space the privacy boundary (every member can read every chat)? | assumed yes | If chats can be private, groups could be too |
| Q7 | Is `expected_etag` on PATCH checked only against the local copy? | assumed yes | Decides whether Anytype alone can ever serialise anything |
| Q8 | Memory, skills, logs and suggestions: which first, and in which form? | none in v0 | All exist in the `anytype-agents` skill |
| Q9 | Share Michel's adapters as a published package instead of copying them? | copy with provenance | [research/michel-reuse.md](research/michel-reuse.md) |
| Q10 | Should ADR 0010 be accepted (own the workflow, no temporal-agent-harness)? | proposed | Owner raised the concern |
| Q11 | Package and binary names: `anyagent` CLI, `@anyagent/*` packages? | as written | |
| Q12 | Gateway high availability: one instance, or two in parallel from the start? | one | Idempotency keys already make double delivery harmless ([ADR 0011](adr/0011-event-gateway.md)) |
| Q13 | Agent replies: one final message, or a "working…" message edited as the turn streams? | one final message | Editing costs writes and sync traffic |
