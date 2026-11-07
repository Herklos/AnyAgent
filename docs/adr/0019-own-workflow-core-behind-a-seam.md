# ADR 0019: Own the small workflow core behind a seam; no agent framework

- Status: accepted (owner, 2026-11-07: option C, "own core now, decide on the harness at v1", [Q20](../OPEN-QUESTIONS.md)). It replaces decisions 3 and 5
  of [ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md) and nothing else in it.
- Date: 2026-11-07

## Context

[ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md) decided to depend on `@temporalio/agent-harness` from npm, not
vendored. The owner then asked whether that layer is worth adding or should be written by us, and whether to use or create an
agent framework. The evidence, the options and what could not be measured are in
[research/harness-vs-own-vs-framework.md](../research/harness-vs-own-vs-framework.md). In short:

- v0 needs about 200 lines of workflow code: message admission with dedupe and a queue, a turn loop, status, close and a
  rotation query. The harness brings a pinned Temporal SDK (its deep import is still there in `0.4.0`), a second experimental
  package, `@internal` calls for the approval bridge (Michel's audit G37), no continue-as-new, and about 4,800 lines in the
  workflow bundle.
- The harness's real value for anyagent is the approval gate (v1) and auto mode (v3), roughly 250 and 100 upstream lines of
  concurrency-sensitive code, plus steering later.
- Three of the four harnesses are external programs that own their loop, so an agent framework would only touch the
  OpenAI-compatible kind.

## Decision

1. **An `AgentCore` seam.** The workflow code of an agent is written against one small interface in
   `packages/workflows`: admit a typed message (dedupe by update id, queue while a turn runs, ordered turns), run the handler,
   answer status and rotation queries, close (waiting for the turn in flight). Later releases extend it with an approval gate
   and auto mode. The activities, the gateway and the harness adapters know nothing about the implementation.
2. **v0 ships our own `AgentCore`**, about 200 lines on `@temporalio/workflow`, with a conformance suite that runs against a
   Temporal test environment. It follows upstream's vocabulary where it costs nothing (message dispositions `opened` and
   `queued`, per-message ids, a status shape), so a later swap is cheap. Upstream is MIT; any code taken is attributed.
3. **The decision about the approval gate is made at v1**, with the criteria in
   [the research, section 9](../research/harness-vs-own-vs-framework.md): adopt the harness behind the seam only if it supports
   our Temporal SDK version, offers a public way to reach its approval gate, has stable APIs across two minor releases, and its
   history cost measured by spike 006 is within 2 times of ours; otherwise write the gate ourselves (about 1 to 1.5 weeks).
4. **Pins.** Until the owner decides, every `@temporalio/*` package stays at the exact version in
   [AGENTS.md](../../AGENTS.md) rule 8 (1.24.0) so that adopting the harness remains possible. If this ADR is accepted and the
   harness is not adopted, the pin may move to the current SDK in its own commit.
5. **No agent framework.** anyagent builds a small library: the harness-adapter registry (Michel's, copied with provenance),
   an OpenAI-compatible model client, and the seams `Backend`, `HarnessSession` and `AgentCore`. Pydantic AI is Python and is
   rejected for that reason. The Vercel AI SDK, with Temporal's `@temporalio/vercel-ai-sdk`, is a candidate **as a library
   inside an activity** for the OpenAI-compatible kind only, to be evaluated after v1 if provider breadth (Anthropic and
   Gemini endpoints, [ADR 0014](0014-model-endpoints-local-and-cloud.md)) is wanted.

## Consequences

- v0 has no dependency on an experimental package; the history cost per message is known by construction (about 8 to 10
  events, inferred).
- The v1 approval gate may be written by us (about 1 to 1.5 weeks) or adopted; the choice is deferred to when it has data.
- Roughly 2 more engineer-weeks over v0 to v3 than adopting the harness now, in exchange for no lock-in and freedom on SDK
  versions. If the owner prefers to adopt now (option A), only the `AgentCore` implementation changes; the seam and its tests
  are the same.
- Real continue-as-new becomes possible inside our own workflow, but the gateway rotation of
  [ADR 0011](0011-event-gateway.md) stays: a message sent between runs still needs update-with-start.

## Extension points

- `AgentCore` implementations are registry entries: `own` (v0), `harness` (a thin adapter over `@temporalio/agent-harness`,
  only if the criteria are met).
- The approval gate and auto mode are separate modules of the core, each with its own contract tests.
- Model clients are a kind (`openai_compatible` now; native Anthropic or Gemini through a library later).

## Not generalised

- No agent framework, no graph or planner abstraction, no second durable runtime beside Temporal.
- No event stream, replay UI, subagent composition or Code Mode.
