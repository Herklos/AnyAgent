# v2 WP3: hierarchy, shared prompts and rules, session scope

**Goal.** An agent's behaviour is assembled from objects people can read and edit: its role, its linked prompts, the org's shared rules, its group's purpose and its manager chain, read fresh at every turn, with a recorded version, and its harness session is kept per agent or per task as chosen.

**Depends on:** WP1. **Unblocks:** WP8.

## Scope

In: prompt kinds and assembly order, size limits and the "what the agent was told" record, `aa_reports_to` validation and the escalation path text, `aa_session_scope`, live configuration at turn boundaries, `doctor`.
Out: a library search tool, memory and skills, prompts written by agents (v3 permissions), approval criteria prompts (v3 uses the `approval_criteria` kind).

## Read first

[specs/schema.md](../../specs/schema.md) (`aa_prompt`, `aa_agent`, `aa_settings`), [ARCHITECTURE.md](../../ARCHITECTURE.md) section 7 (live configuration), [VISION.md](../../VISION.md) principle 5, [ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md), and from v1 `packages/node/src/activities/resolve-config.ts`, `packages/core/src/agent-spec.ts`.

## Files

Create: `packages/core/src/{prompt-assembly.ts,hierarchy.ts}`, `packages/node/src/session-scope.ts`, tests, `docs/specs/prompt-assembly.md`.
Change: `packages/core/src/agent-spec.ts` (new fields), `packages/node/src/activities/{resolve-config,run-turn}.ts`, `packages/node/src/store.ts` (sessions keyed by scope), `docs/specs/agent-workflow.md`, `apps/cli` (`agent show`, doctor).

## Behaviour

1. **Assembly order** (`prompt-assembly.ts`, pure), the instructions given to the harness each turn, as separate labelled sections: (1) the settings' **rules** (`aa_settings.aa_rules`, in the listed order); (2) the agent's **system** prompts (`aa_prompt` of kind `system`, in the listed order); (3) the agent's **role** (its own object body);
   (4) the **library** prompts it links (kind `library`, listed by title with the body included up to the budget); (5) the **organisation context**: its manager chain (handles and one-line roles, up to 5 levels, cycles cut), its reports, and the current group's purpose (WP2). A prompt of kind `approval_criteria` is never included in an agent's instructions.
2. **Budget:** the whole assembly is capped (`tuning.promptBudgetChars`, default 24,000). Over budget, drop library prompts from the end, then truncate the longest section with a visible marker; never truncate rules or the role silently: if they alone exceed the budget the turn is refused with the notice `The instructions for @<handle> are too long (<n> characters, limit <m>).`
3. **Live configuration:** everything is read in `resolveConfig` at each turn start, never cached across turns; an edit applies at the next turn boundary, never mid-turn. The turn records `aa_version` of each prompt used, and the assembled text's hash, in the node's turn log (WP6 of v1) and logs, so "what was this agent told at that time" can be answered.
4. **Hierarchy:** `aa_reports_to` is validated: no self-report, no cycle (a cycle is reported once and the loop cut at the repeat), the target is a live or draft agent in the same org. The chain is context only; it does not grant rights (permissions are WP7 and v3). The lead of a group is the escalation point named in a notice when an agent cannot proceed.
5. **Session scope:** `aa_session_scope` is `agent` (one long harness session, the v0 behaviour, the default) or `task` (a fresh session per task: the session key becomes `<workflowId>:<taskId>` when the turn belongs to a task, else the agent's single session). Switching the scope never deletes sessions; the old key is simply unused.
6. **Prompt bodies are untrusted data in one sense:** a person edits them, but an agent without permissions cannot (WP7), and a prompt is never executed or templated; it is text only (no `{{…}}` expansion in v2).

## Steps

1. `prompt-assembly.ts` with the budget logic and golden tests (inputs to the exact output text).
2. `hierarchy.ts` (chain, cycles) and spec validation.
3. Session keys by scope in the node store; `run-turn` uses them.
4. `resolveConfig` returns the assembled sections, versions and hash; the turn log records them.
5. `docs/specs/prompt-assembly.md`; `agent show <handle>` prints what the next turn would be told (for people to check, with the budget use).

## Tests

- T-V2-WP3-01 golden assembly: rules, system, role, library, context in the exact order and format.
- T-V2-WP3-02 budget: library dropped from the end first; the longest section truncated with the marker; rules and role never silently truncated; the refusal notice when they alone exceed the budget.
- T-V2-WP3-03 `approval_criteria` prompts are excluded from instructions; unknown kinds are ignored with a doctor warning.
- T-V2-WP3-04 hierarchy: self-report, a two-agent cycle, a deep chain cut at five levels, a manager that is archived.
- T-V2-WP3-05 live configuration: edit a prompt between two turns and the second turn uses it; an edit during a turn does not change that turn.
- T-V2-WP3-06 versions and hash are recorded for each turn.
- T-V2-WP3-07 session scope: `agent` reuses one session across tasks; `task` gives two tasks two sessions and returns to the first task's session on its next turn; switching scope loses nothing.
- T-V2-WP3-08 `agent show` output equals the assembly used by a real turn (compare strings).
- T-V2-WP3-09 a prompt body containing `{{secret}}` or instructions to ignore rules is passed as text unchanged, inside its labelled section.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/node test
pnpm check
```

## Achievements

- [ ] An agent is told exactly what its objects say, in a documented order, within a budget, and an edit applies at the next turn.
- [ ] "What was this agent told?" is answerable from the turn log.
- [ ] Hierarchy and session scope work and cannot crash on cycles or missing objects.

## Stop and ask when

The harness cannot take instructions as a separate system prompt (then the assembly must be delivered another way, which changes what "instructions" can guarantee); the budget in characters is far wrong for the models in use; a person wants templating in prompts.
