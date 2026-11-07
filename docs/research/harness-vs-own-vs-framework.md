# Own the workflow layer or use temporal-agent-harness? And a framework or not?

Research for [ADR 0019](../adr/0019-own-workflow-core-behind-a-seam.md) (accepted: option C, 2026-11-07). Read 2026-11-07. Claims are labelled
**measured** (counted or read in code), **reported** (a source says so), or **inferred** (my reasoning).

## The two questions and the short answers

1. **Is `@temporalio/agent-harness` a valuable addition, or should anybot write that layer itself?**
   For **v0** it is not worth its costs: v0 needs about 200 lines of workflow code that the harness would replace, and the
   harness brings a pinned SDK, a second experimental package, `@internal` calls, and about 4,800 lines in the workflow bundle
   where v0 needs about 200. From **v1** (the approval gate) and **v3** (auto mode) the harness has real value, so the recommendation is to
   build the small core **behind a seam**, and decide again at v1 against measurable criteria (section 9) instead of
   committing for ever either way.
2. **Should we create our own framework, or use one like Pydantic AI?** Neither. Pydantic AI is Python and anybot is
   TypeScript. And a framework owns the agent loop, but in anybot three of the four harnesses are external programs that
   own their own loop (Claude Code, Codex, Grok Build). What we need is a small **library** (the adapters and a model
   client), not a framework. A TypeScript framework such as the Vercel AI SDK is only a candidate for the one
   OpenAI-compatible kind, later.

## What was checked, and what was not

Checked: the upstream repository at `9eaf026` (cloned), the published packages `0.3.1` and `0.4.0` (npm registry metadata,
and read-only reads of the `0.4.0` tarball), Michel's code, audit and measurements (`Herklos/Michel@402865d`), upstream's own
positioning documents, and the Temporal, Pydantic AI and Vercel AI SDK integration pages through search.

**Not done:** no runtime measurement. A Temporal server could not be run here (a download of the CLI was fetched and then
discarded unextracted, because running a downloaded binary was refused), so [spike 006](../SPIKES.md) is still open and the
number that matters most, history events per message in our shape, is inferred, not measured. `0.4.0` was read, not
installed. Own-implementation sizes are estimates.

## 1. What anybot needs from a workflow layer

| Need | Release | Notes |
| --- | --- | --- |
| One long-lived workflow per agent, started by update-with-start | v0 | Temporal itself ([ADR 0003](../adr/0003-one-shared-temporal-one-workflow-per-agent.md)) |
| Typed message admission, dedupe by update id, queue while a turn runs, ordered turns | v0 | the `chat` handler |
| Turn loop: run one activity per turn, reply, survive crashes | v0 | the loop is inside the activity for every harness ([agent-workflow spec](../specs/agent-workflow.md)) |
| Status query, close, idle close, a rotation hook | v0 | |
| Approval gate: policy, pending approvals with expiry, a person's decision, `remember` | v1 | |
| Schedules wake an agent | v1 | Temporal Schedules and our `ScheduleKick`, not the harness |
| Stop a running turn | v1 | |
| Auto mode: a decision model races a person and never fails open | v3 | |
| Mid-turn steering | after v3 | |
| Event stream, replayable history, UI components, subagent composition, Code Mode | never | Anytype is the UI and the record; agents are separate workflows |

## 2. What the harness is

- **Purpose, in upstream's words** (`docs/internal/what-the-harness-adds.md`): it "does **not** add new
  distributed-systems primitives. Its net-new value is **standardization**": one interface, one event stream and one
  approval model across a heterogeneous fleet of agents. "Durability, composition, and durable HITL are Temporal
  primitives you *can* build yourself; the harness's bet is that a uniform contract + event stream + approval model across
  every agent is worth conforming each agent to one shape." Its value "scales with heterogeneity and fleet size". It is
  "infrastructure (wraps a loop)", not a framework.
- **Size (measured, non-test lines):** core 6,728, worker 3,790, client 4,073. Importing the package root reaches 4,790 lines
  of core; the part `defineAgent` needs reaches 2,270, of which the runner is 1,061 (`agent-workflow.ts`). Anything the
  root imports goes into the workflow bundle.
- **Dependencies:** `@temporalio/workflow-streams` (an official but self-described experimental package, whose publishes are
  Signals), `immer`, `zod`, and optional peers on AI SDKs. `node_modules` was about 270 MB in the earlier install check.
- **Maturity:** "Experimental. APIs change between releases." Published on npm only since 2026-11-02; `0.3.1` on 11-05 and
  **`0.4.0` on 11-07** (six releases in five days). Before 10-29 two of its packages were private, which is why Michel
  vendors a fork.
- **Team (measured):** 8 author names (four people with 40 or more commits each, one of them under two names), about 36 commits a month since June 2026, 45
  TypeScript-touching commits in the last 30 days, 47 test files. It is not a one-person project.
- **State of the three known gaps in `0.4.0`** (read from the tarball): the deep import of `@temporalio/common/lib/time.js`
  (`dist/src/harness/agent-workflow.js`, line 10) is **still there**, so it still fails on SDK 1.25 (released 2026-10-27)
  and our exact pin to 1.24.0 stays; there is **no continue-as-new** anywhere in the package; **steering is now exported**
  (`ClaimedSteering`).

## 3. Evidence from the one adopter: Michel

- **Thin use.** Michel's whole use is one 145-line file (`packages/temporal/workflows/src/agent.ts`): `defineAgent`, one
  handler with `MidTurn.ENQUEUE`, `setApprovalPolicy`, and `runner.applyApprovalPolicy`. Michel's own channel workflow
  (294 lines) does not use the harness.
- **An `@internal` call.** `applyApprovalPolicy` is marked `@internal` upstream (`agent-workflow.ts`, line 661). Michel's
  audit G37 records that a permission request raised inside a node activity "has no documented path" to the gate, so
  Michel adds its own update, a per-request-id decision map, and smuggles the human title through a reserved key in the
  tool input (`TITLE_KEY`) because the approval event carries only the tool name and input.
- **Measured history cost** (Michel `docs/research/spikes-v0.md`, section 0.7): about **160 events and 90 KB per turn**, and
  468 accepted updates for 25 turns, "mostly caused by the hub's stream polling (an update per poll)". At that rate an agent
  reaches Temporal's 51,200-event limit in roughly 300 turns. Michel rotates an idle agent's workflow past 20,000 events.
  Two things limit how far this transfers: Michel streams reply deltas and polls the harness stream, which anybot would not.
- **Rotation is outside the harness.** Michel's note: the agent workflow "cannot continue-as-new"; the hub rotates between
  turns; a message sent between runs reaches a closed workflow and the sender must retry or start the workflow.
- **Provenance.** Michel started on a pinned submodule of a fork and was "decided: own fork" (audit G36) because the packages
  were private; the fork carries no patches.

## 4. Fit: what the harness gives us, feature by feature

| Harness feature | Used by anybot? | Value to us |
| --- | --- | --- |
| Update-based message admission, `MidTurn` queue, `AgentClosed` rejection, dispositions | yes, v0 | medium: about 250 upstream lines, a pattern we could write in about 150 |
| Approval gate with parked gates, `remember`, expiry | yes, v1 | **high**: the concurrency-sensitive part |
| `AutoModeEvaluator` raced against a person ("cancels the loser") | yes, v3 | **high** |
| Status query, close signal, idle close | yes, v0 | low: tens of lines |
| Steering (`0.4.0`) | later | medium |
| Event stream (`workflow-streams`), `turn_events`, replay, merge | no | none, and it costs history events |
| Subagents, Code Mode, observable state, React and Svelte clients, console | no | none |
| OpenAI Agents SDK and Gemini integrations | no | none: anybot runs harnesses in activities |
| Standard interface for a fleet behind one UI | no | none: one product, Anytype is the UI |

The pattern is clear: what anybot can use is about 550 of the runner's 1,061 lines, and almost all of the value is in the
approval gate and auto mode, which arrive in v1 and v3. v0 uses the least valuable slice.

## 5. What owning the layer would cost (estimates)

Upstream line counts are measured; the "ours" column is my estimate, smaller because there is no stream and one workflow type.

| Piece | Upstream lines (measured) | Ours (est.) | Effort with tests (est.) | Release |
| --- | --- | --- | --- | --- |
| Admission, queue, turn loop, status, close, idle, rotation query | 244 (`agent-workflow.ts` 417–660) | 150–200 | 3–4 days | v0 |
| Approval gate, pending list, expiry, decision update, `remember` | about 150 (661–911, without auto mode) | 250–300 | 1–1.5 weeks | v1 |
| Auto-mode race with a decision model, hard floors | about 100 inside the same range | 100–150 | 3–4 days | v3 |
| Steering | 58 (343–400) | 80 | 2–3 days | after v3 |
| `defineAgent` and handler plumbing | `agent.ts` 504 | 100 | in the first row | v0 |

About **3 engineer-weeks over v0 to v3**, against roughly one week to integrate the harness (pins, the approval bridge,
learning its protocol) plus recurring upgrade work. Owning the layer is therefore about **2 weeks more in total**, almost
all of it in v1, and none of it in v0.

## 6. Risks of depending on it

| Risk | Evidence | Severity | Mitigation if we depend |
| --- | --- | --- | --- |
| Breaks on the current Temporal SDK; forces an exact pin of every `@temporalio/*` package | deep import still in `0.4.0`; SDK 1.25.0 released 2026-10-27 | medium: blocks SDK upgrades and any package that needs 1.25 | pin to 1.24.0 (AGENTS.md rule 8); report upstream (Q14) |
| Two experimental layers, and history events from the stream | `workflow-streams` is a dependency of the runner; publishes are Signals | medium | do not poll the stream; measure (spike 006) |
| Reliance on `@internal` API for the approval bridge | `applyApprovalPolicy` line 661; Michel G37 | **high** for v1 | pin, wrap in one module, contract test |
| No continue-as-new | `0.4.0` has none | medium: needs gateway rotation, which we need anyway | rotation (ADR 0011) |
| Fast API churn | six releases in five days; "APIs change between releases" | medium | exact pins, upgrade in their own commit |
| Workflow bundle surface | 4,790 lines reachable from the root vs about 1,000 needed | low to medium: cold start, and any upstream non-determinism is ours | none known |
| Replay safety across upgrades | workflow code changes with each release | medium | rotate idle runs before upgrading |
| Governance | `temporal-community`, not Temporal's own org | low to medium | active team, MIT |

Risks of **owning**: concurrency bugs in the approval gate (the race between a person, a timer and a model is easy to get
subtly wrong); and the maintenance is ours. Both are real, and both are bounded by about 600 lines and a conformance suite.

## 7. Options

| | A. Depend on the harness (ADR 0010 as written) | B. Own the core, never the harness | C. Own the small core behind a seam; decide again at v1 |
| --- | --- | --- | --- |
| v0 effort | integrate and pin: about 1 week | about 3–4 days | about 3–4 days |
| v0 risk | pin trap, `@internal`, experimental stack | low | low |
| Latest Temporal SDK | blocked | allowed | allowed |
| History cost | stream signals (measure) | minimal and known | minimal and known |
| v1 approval gate | upstream's tested gate | we write it, 1–1.5 weeks | we choose with data: adopt the harness if it passes the criteria, else write it |
| Future features (steering, UI) | free | we write | free if adopted later |
| Lock-in | high | none | none (the seam) |
| Michel parity | highest | lowest | medium |

**Recommendation: C.** For v0 it is B. It removes the pin and the `@internal` dependency from the critical path of the
smallest release, costs about the same as integrating, and keeps the one decision that has real value (the gate) open until
we have numbers and upstream has moved. It does not throw away anything: upstream's design is MIT and its message protocol
vocabulary (`OPENED`, `QUEUED`, dispositions, a status shape) is worth following so a later swap is cheap.

## 8. The framework question

A framework owns the agent loop (calls the model, runs tools, loops). anybot's loops:

| Harness kind | Who owns the loop | Would a framework help? |
| --- | --- | --- |
| Claude Code, Codex, Grok Build | the external program | no: we drive it over ACP or an app-server |
| OpenAI-compatible (llama.cpp, vLLM, cloud) | Michel's adapter, about 1,400 lines (`openai/`: client 362, session 479, tools 493, MCP 78) | possibly, for provider breadth |
| Decision model (v3) | one structured call returning a JSON verdict | no: a schema and a call |
| Router and classifiers (later) | one call each | no |

| Candidate | Language | Temporal integration | Fit |
| --- | --- | --- | --- |
| **Pydantic AI** | Python | Python only: `pydantic-ai[temporal]`; its docs now say add the `TemporalDurability` capability and mark the older `TemporalAgent` wrapper deprecated (reported) | **No.** It would need a Python worker beside the TypeScript one, break the shared adapters and [ADR 0004](../adr/0004-typescript-over-the-http-api.md), and overlaps only our smallest piece |
| **Vercel AI SDK** | TypeScript | `@temporalio/vercel-ai-sdk` 1.0.0 (published 2026-10-17, first release); older `@temporalio/ai-sdk` has 31 versions since 2025-12 (measured on npm); docs call it public preview and disagree on the package name (reported) | Candidate **as a library inside the activity** for the OpenAI-compatible kind, after v1: provider breadth (Anthropic, Gemini), structured output, MCP client. Not a framework in the workflow |
| **OpenAI Agents SDK** | Python and TypeScript | `@temporalio/openai-agents` 1.24.0 (npm); the harness's OpenAI support is a vendored copy | Overlaps the loop only; OpenAI-centred |
| **Mastra, LangGraph JS** | TypeScript | their own durability; not Temporal-native (reported) | Add a second durable runtime beside Temporal: no |
| **Own library** (adapters registry, model client) | TypeScript | we already have it from Michel | **Yes** |

Why not a framework of our own: AGENTS.md rule 6 and Michel's ADR 0025 (f): "do not build speculative frameworks: a new
abstraction needs two real uses or a named planned one." We have one real use of a model loop (the OpenAI-compatible kind).
What we do build is two seams that have two uses each: `Backend` (two backends, [ADR 0017](../adr/0017-anytype-backend-behind-a-port.md))
and `HarnessSession` (four harnesses), plus the new `AgentCore` seam (section 7).

## 9. Criteria to adopt the harness later (decided at v1, then at each release)

Adopt `@temporalio/agent-harness` behind the seam when **all** hold:

1. it declares support for the Temporal SDK version we run (no deep import; or we run 1.24.0 knowingly for another reason);
2. it offers a public, documented way for an external permission request to reach the approval gate (no `@internal`);
3. it has continue-as-new, or its absence costs us nothing measured;
4. spike 006 measures history events per message in our shape and the result is within 2 times of the own core;
5. its API has been stable across at least two minor releases (it has not been, as of `0.4.0`);
6. the conformance tests for the seam pass on the harness-backed implementation.

Stay on the own core when any of 1, 2 or 5 fails at v1. Revisit when upstream tags 1.0 or changes the criteria's status.

## 10. What this analysis does not establish

- History events per message and per turn for either implementation (needs spike 006 on a Temporal server).
- Whether `0.4.0` behaves as read: it was not installed or run, and its changes since `0.3.1` were not reviewed beyond the
  three gaps.
- The own-core effort numbers: they are estimates from upstream line counts.
- The current Pydantic AI and Vercel AI SDK pages beyond what search results reported; those sources conflict on names and
  status.
- Anything about Temporal Cloud behaviour.

## Sources

- Upstream: [temporal-community/temporal-agent-harness](https://github.com/temporal-community/temporal-agent-harness) at `9eaf026`
  (`docs/internal/what-the-harness-adds.md`, `docs/internal/agentevent-workflow-stream.md`), and the npm packages
  [`@temporalio/agent-harness`](https://www.npmjs.com/package/@temporalio/agent-harness) (0.3.1, 0.4.0) and
  [`@temporalio/workflow-streams`](https://www.npmjs.com/package/@temporalio/workflow-streams).
- Michel (`Herklos/Michel@402865d`): `packages/temporal/workflows/src/agent.ts`, `docs/AUDIT.md` (G36, G37, G46),
  `docs/research/spikes-v0.md` section 0.7, `docs/adr/0024-typed-nodes.md`, `docs/research/sandbox-spike.md`.
- Pydantic AI and Temporal (reported): [ai.pydantic.dev/temporal](https://ai.pydantic.dev/temporal),
  [pydantic.dev durable execution with Temporal](https://pydantic.dev/docs/ai/capabilities/durable_execution/temporal/),
  [Temporal blog](https://temporal.io/blog/build-durable-ai-agents-pydantic-ai-and-temporal).
- Vercel AI SDK and Temporal (reported): [docs.temporal.io](https://docs.temporal.io/develop/typescript/integrations/ai-sdk),
  [Temporal blog](https://temporal.io/blog/building-durable-agents-with-temporal-and-ai-sdk-by-vercel),
  [changelog](https://temporal.io/changelog/ai-sdk-vercel-integration).
- Package versions and dates: npm registry, read 2026-11-07.

## Measured

(WP3 / spike 006, 2026-11-07.) The own-core contract suite passes against Temporal CLI's local test server (SDK 1.24.0).
A dedicated 50-message history events/bytes table is not yet recorded; see [spikes/006-agent-core](../../spikes/006-agent-core/README.md).
The estimate to beat remains 8–10 events per message vs Michel's ~160 events per streaming harness turn.

