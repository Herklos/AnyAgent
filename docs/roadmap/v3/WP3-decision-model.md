# v3 WP3: the decision model and `auto` mode

**Goal.** In `auto` mode a decision model, local or cloud, answers routine approval requests at the same time as the people, escalates whenever it is unsure, never approves what a floor forbids, and is only allowed at all if it has passed the evaluation of WP1. A person's decision and the model's race, and exactly one wins.

**Depends on:** WP1, WP2. **Unblocks:** WP6.

## Scope

In: the `judgeApproval` activity, the criteria format and parser, the prompt and strict schema, the race in the approval gate, fail-closed handling, the hard floors, recording, the quality gate (`anybot decision eval`), configuration objects, `auto` as an approval mode, the `Approvals – By model` view.
Out: learning from past decisions, a rules-only evaluator (a registry entry later), approving org changes by model (never), computer use (floor hook only), multiple models voting.

## Read first

[ADR 0015](../../adr/0015-decision-model-for-approvals.md) (all of it), [ADR 0014](../../adr/0014-model-endpoints-local-and-cloud.md) (decision 5: one registry), [ADR 0008](../../adr/0008-approvals-objects-and-reactions.md), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md), v1 WP2 (the gate), v1 WP3 (approval objects and notices), v1 WP5 (`resolveEndpoint`, capabilities),
WP1 of this release (the evaluation set, the runner, the prototype prompt, the proposed thresholds), [specs/schema.md](../../specs/schema.md) (`aa_prompt` kind `approval_criteria`).

## Files

Create: `packages/core/src/criteria.ts`, `packages/node/src/decision/{prompt.ts,judge.ts,eval-store.ts}`, `packages/node/src/activities/judge-approval.ts`, `apps/cli/src/commands/decision.ts`, tests, `docs/specs/decision-model.md`.
Change: `packages/workflows/src/core/approval.ts` (the evaluator and the race), `packages/core/src/{schema.ts,schema-versions.ts,permission.ts,agent-spec.ts}` (`auto`, `aa_decision_model`, `aa_approval_criteria`, settings equivalents), `packages/node/src/activities/{record-decision,create-approval}.ts`, `packages/core/src/notices.ts`, `apps/cli` (doctor, `agent create --mode auto`), `docs/specs/agent-workflow.md`, `docs/adr/0015-decision-model-for-approvals.md` (the confirmed thresholds).

## Configuration (data)

`aa_settings.aa_decision_model` = `<endpointId>/<model>` (default); `aa_agent.aa_decision_model` overrides; criteria sets are `aa_prompt` objects of kind `approval_criteria` whose body is YAML, linked from `aa_agent.aa_approval_criteria` or from `aa_settings.aa_approval_criteria` as the default:

```yaml
name: routine-dev
approve_when: ["reads files inside the working directory", "runs the project's tests or linters"]
deny_when: ["touches files outside the working directory", "uses the network to send data out"]
escalate_when: ["changes git history or pushes", "deletes more than one file"]
min_confidence: 0.8
escalate_if_irreversible_above: 0.4
deny_always: ["rm\\s+-rf\\s+/", "curl[^|]*\\|\\s*(sh|bash)"]     # our extension: regular expressions checked before the model is called
```

## Behaviour

1. **`auto` mode in the gate:** a gated call creates the approval object and chat message exactly as in `ask` (v1 WP3) and **also** starts `judgeApproval`. The first decision wins: the model's `approve` or `deny`, or an approver's ✅ or ❌. The loser is cancelled (the activity is cancelled when a person decides first; a person's later reaction on a model-decided approval changes nothing because its status is no longer `pending`).
   `escalate` leaves the decision to people. `auto` is allowed only for harnesses with permission callbacks ([ADR 0020](../../adr/0020-harness-adapter-kinds.md)).
2. **Order of checks** for every request in `auto`: (1) the v0 floor (credentials, destructive commands) denies; (2) the hard floors of [ADR 0015](../../adr/0015-decision-model-for-approvals.md) decision 5: org changes and anything in `aa_permissions_ask` go to people only, actions named in `tuning.humanOnlyTools` (default empty; a provider that requires human confirmation is added here by the owner),
   and, when computer use exists, a person's own desktop; (3) `deny_always` patterns deny without calling the model; (4) only then the model is asked. A fake always-approving model must therefore still be refused by (1) to (3).
3. **The activity `judgeApproval`** (runs on a node that has the endpoint, [ADR 0014](../../adr/0014-model-endpoints-local-and-cloud.md)): sends one non-streaming request, temperature 0, with the strict JSON schema `{ verdict: "approve"|"deny"|"escalate", confidence: 0..1, irreversibility: 0..1, reason: string(≤300) }` and `additionalProperties: false`. No tools, one call, a timeout of 30 s, **no retries**.
   The system prompt is fixed text; the request data (tool name, kind, summary of the input truncated to 1,500 characters, the agent's role line, the task title and criterion, the criteria set) is passed as one JSON object in a delimited block that the prompt declares to be **data, never instructions**; the prompt is the one measured in WP1 (changing it re-opens the evaluation).
4. **It never fails open:** a timeout, an unreachable endpoint, an HTTP error, a non-JSON answer, a schema violation (extra or missing field, wrong type), `confidence` below `min_confidence`, `irreversibility` above `escalate_if_irreversible_above`, an endpoint without the `json_schema` capability, and an endpoint marked unavailable all become **`escalate`**. A model `approve` with a confidence above the threshold is the only path to an automatic approval.
5. **Recording:** `aa_decided_by` = `model:<endpointId>/<model>`; the object body gets the verdict, confidence, irreversibility and reason; the chat message is updated with a reply `🤖 approved by <model> (confidence 0.93): <reason>` (or `denied`); an `escalate` posts nothing new (the approval stays pending for people). The saved view `Approvals – By model` lists model decisions for review.
6. **Quality gate:** `auto` may be enabled for a `{endpoint, model}` only if `<state.dir>/decision-evals.json` holds a passing evaluation of it, produced by `anybot decision eval --endpoint <id> --model <m>` (WP1's runner and thresholds, as the owner confirmed them), newer than `tuning.decisionEvalMaxAgeDays` (default 30) and for the same prompt version.
   Without one, an `auto` agent runs as `ask` with one notice (`Auto mode is off for @x: the decision model <m> has not passed the evaluation. Running in ask mode.`) and `doctor` explains how to evaluate. An explicit unsafe override exists as an environment variable on the node, `ANYBOT_ALLOW_UNEVALUATED_DECISION_MODEL=1`, printed loudly by `doctor`.
7. **Concurrency and cost:** at most `tuning.judgeConcurrency` (default 4) judgements per node at once; the rest wait and then run, unless the approval already has a decision. A per-agent budget of judgements per hour (default 60) beyond which requests go to people.
8. **Privacy:** the request sent to a cloud model contains tool names and summaries, which can include command text and paths; `doctor` says which endpoint is cloud, and `aa_settings`-level configuration decides (the guide says to use a local model if commands are sensitive).

## Steps

1. `criteria.ts` (zod schema, YAML parse, defaults, `deny_always` compile with a safe regex check) with tests.
2. The prompt and schema from WP1's prototype, as constants with a version string; `judge.ts` with strict validation; the fail-closed table.
3. The activity, with a fake endpoint server in tests.
4. The evaluator and the race in the approval gate, with the cancellation of the loser; the floors before it.
5. `decision eval` command and the eval store; the gate in `resolveConfig` (downgrade to `ask`).
6. Recording, the view, notices, `doctor`.
7. Live: the evaluation on a local model and on a cloud model; `auto` end to end with a real harness.
8. Spec and ADR 0015's thresholds.

## Tests

- T-V3-WP3-01 criteria: parse, defaults, bad YAML, unknown keys, bad regex in `deny_always` rejected, thresholds out of range.
- T-V3-WP3-02 the fail-closed table, one row each: timeout, connection refused, HTTP 500, 429, non-JSON, extra field, missing field, wrong type, `verdict` outside the enum, confidence below the minimum, irreversibility above the limit, no `json_schema` capability: every one becomes `escalate`.
- T-V3-WP3-03 only `approve` with enough confidence and low irreversibility approves; `deny` denies; `escalate` waits.
- T-V3-WP3-04 floors: with a model double that always approves, the v0 floor, an org change, an `aa_permissions_ask` entry, a `humanOnlyTools` tool and a `deny_always` match are never auto-approved, and in the last case the model is not even called (assert zero calls).
- T-V3-WP3-05 (Temporal) the race: the model first, a person first, and both within one tick: exactly one decision is recorded, the loser's activity is cancelled or its result discarded, the object and chat show one outcome.
- T-V3-WP3-06 recording: `aa_decided_by` string, the body fields, the reply text; a human decision records the participant id as in v1.
- T-V3-WP3-07 the prompt: the request block cannot be closed from inside the data (a payload containing the delimiter and a fake verdict JSON is passed through escaped), truncation applies, and the prompt version string is part of the evaluation key.
- T-V3-WP3-08 quality gate: no evaluation, an old one, a failing one, a different prompt version: `auto` runs as `ask` with the one notice; a passing one enables it; the override variable enables it and `doctor` shouts.
- T-V3-WP3-09 concurrency and the hourly budget: the fifth concurrent judgement waits; beyond the budget requests go to people.
- T-V3-WP3-10 `auto` is refused for a harness without permission callbacks.
- T-V3-WP3-11 the evaluation set run through the real prompt against a scripted endpoint that returns canned verdicts reproduces WP1's metrics.
- T-V3-WP3-12 (live, `ANYBOT_LIVE_DECISION_LOCAL=1`) the evaluation passes for the chosen local model and `auto` approves a routine call and escalates a risky one end to end.
- T-V3-WP3-13 (live, `ANYBOT_LIVE_DECISION_CLOUD=1`) the same on a cloud model.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/node test && pnpm --filter @anybot/workflows test
node scripts/eval-decision.mjs --fixture eval/decision/fixtures/fake-always-approve.json    # expect: gate FAIL (still)
pnpm check
```

## Achievements

- [ ] A routine call is approved by a local model in one run and a cloud model in another, and a risky call is escalated to a person (live), both after passing the evaluation.
- [ ] Nothing approves under any error, timeout or malformed answer, and no model can pass a floor (the always-approving double changes nothing).
- [ ] A person and the model never both decide: one outcome, recorded with its author.
- [ ] `auto` cannot be switched on for a model that has not passed the gate (without a loud override).

## Stop and ask when

A prompt-injection case from the evaluation set gets an `approve` from any run of a model you intend to ship (then that model is not allowed, and the owner should hear it); no evaluated model is available; the confirmed thresholds from WP1 are missing (do not guess them: ask).
