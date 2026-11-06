# ADR 0014: Model endpoints: llama.cpp and any OpenAI-compatible API, local or cloud

- Status: accepted (owner's request, 2026-11-06: "support local models with llama.cpp and local/cloud OpenAI compatible
  endpoints")
- Date: 2026-11-06

## Context

Agents run either a CLI harness that brings its own model access (Claude Code, Codex, OpenCode, any ACP agent) or a
model API driven by anyagent's own tool loop. Michel's `openai` adapter is that loop: an OpenAI-compatible client with
built-in tools and an MCP bridge ([research/michel-reuse.md](../research/michel-reuse.md)). Michel already lists
llama.cpp among its targets (Michel `docs/adr/0003-harness-adapters.md`, line 12; `docs/PLAN.md`, line 429:
"`openai_compatible` | `baseURL` + key + model discovery (`GET /v1/models`) | … Ollama, vLLM, LM Studio, llama.cpp,
MLX, OpenRouter").

Verified in `ggml-org/llama.cpp@669204e` (2026-11-06), `tools/server/README.md`: `llama-server` serves
`GET /v1/models` and `POST /v1/chat/completions` ("OpenAI-compatible API Endpoints", lines 1344–1438); "OpenAI-style
function calling is supported with the `--jinja` flag (and may require a `--chat-template-file` override …)" (line
1518), and `--jinja` is on by default (line 235); `--api-key` sets bearer keys (line 215).

Models are also needed outside agent turns: the decision model for approvals ([ADR 0015](0015-decision-model-for-approvals.md)),
and later summaries and routing.

## Decision

1. **Endpoints are node configuration.** Each node lists the model endpoints it can reach:
   `endpoints: [{id, kind: openai_compatible, baseURL, keyEnv?, models?, capabilities?}]`. Examples:
   `llama-local` → `http://127.0.0.1:8080/v1` (a `llama-server` on the node); `lan-gpu` → a vLLM or `llama-server`
   on another machine of the private network; `openrouter` or `openai` → a cloud API with a key in `keyEnv`. Keys never
   enter Anytype.
2. **Agents name an endpoint and a model.** `aa_agent.aa_harness = openai` (the OpenAI-compatible loop),
   `aa_agent.aa_endpoint` = an endpoint id, `aa_agent.aa_model` = a model id. The agent's home node must have that
   endpoint; otherwise the turn is refused with a notice, as for accounts.
3. **llama.cpp is a first-class target**, not a special case. It is an `openai_compatible` endpoint, and the node
   probes it at start with `GET /v1/models`. The setup guide documents `llama-server --jinja` and the chat-template
   caveat for tool calls. A model whose template does not produce tool calls is reported as `tools: false` and refused
   for agents that need tools.
4. **Capabilities are probed or declared, not assumed**: `tools`, `vision` (needed for screenshot-based computer use,
   [ADR 0016](0016-computer-use-with-cua.md)) and `json_schema` (needed by the decision model). A declared value in
   config overrides a probe.
5. **One registry for every model use.** Agent turns, the approval decision model and future utility uses all resolve
   `{endpoint, model}` through the same node registry.

## Consequences

- An all-local deployment works: self-hosted Temporal and any-sync, `llama-server` on a node, no cloud account.
- Tool calling with local models depends on the model and its chat template. anyagent reports what it found instead of
  failing mid-turn.
- CLI harnesses that can themselves point at an OpenAI-compatible endpoint (for example OpenCode) may later receive the
  endpoint through their own config. That is not verified and not in v0.

## Extension points

- Endpoint kinds: `openai_compatible` in v0. Native kinds (Anthropic Messages, Gemini, Apple Foundation Models through
  Michel's ACP helper) are registry entries.
- Fallback chains (Michel ADR 0018 harness profiles) are later data on the agent.

## Not generalised

- No model download or lifecycle management: people run `llama-server` or their API account themselves.
- No load balancing across endpoints.
