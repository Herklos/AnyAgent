# ADR 0009: A new minimal, versioned schema with prefixed type keys

- Status: accepted (owner, 2026-11-06), including the `aa_` key prefix (Q1, settled the same day)
- Date: 2026-11-06

## Context

The `anytype-agents` skill defines about twenty types (`agent`, `team`, `subteam`, `subagent`, `harness`,
`harness_profile`, `browser`, `computer`, `tool_profile`, `runtime`, `vault_grant`, `prompt`, `memory`, `skill`, `log`,
`suggestion`, `schedule`, `group`, `project`, `epic`, `user_story`, extended `task`), many of them shaped for Hermes
(`hermes_profile`, `platform_chat_id`, `aux_*` fields). The owner chose a **new minimal schema** for anybot.

Anytype already has a built-in `task` type, and the owner's space already has `agent`, `group`, `schedule` from the
skill. Reusing those keys with different properties would corrupt both.

## Decision

1. anybot defines its own small set of types: `aa_settings`, `aa_node`, `aa_agent`, `aa_prompt`, `aa_group`,
   `aa_task`, `aa_schedule`, `aa_trigger`, `aa_approval`. Spec: [specs/schema.md](../specs/schema.md).
2. Type and property keys are prefixed `aa_` so they can live next to the skill's types and Anytype's built-ins.
   Display names are plain (`Agent`, `Task`, …).
3. The schema is versioned: `aa_settings.schema_version`. `anybot bootstrap` creates the types, properties,
   templates and Queries in a space; `anybot migrate` moves a space forward. Changes are additive within a major.

## Consequences

- anybot can be tried in the existing org's space without touching it.
- Moving the Hermes fleet over is an explicit migration (later).

## Extension points

- New capabilities add types or properties additively, behind a schema version.

## Not generalised

- No mapping layer that reads the skill's types.
