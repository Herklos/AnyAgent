# v1 WP5: model endpoints and the OpenAI-compatible harness

**Goal.** An agent can run on any OpenAI-compatible endpoint (a `llama-server` on the node, vLLM on another machine, a cloud API) through a tool loop that obeys the same `read_only`, `ask` and `full` rules as the CLI harnesses, with the endpoint's abilities probed instead of assumed.
This package is the second half of **spike 007**.

**Depends on:** v0 (WP2 for `ask`). **Unblocks:** WP8, and v3's decision model (it shares the endpoint registry).

## Scope

In: node configuration `endpoints`, the registry that resolves `{endpoint, model}`, capability probing, the in-process loop adapter copied from Michel, `aa_endpoint`, tool confinement, live checks on `llama-server` and a cloud endpoint.
Out: native Anthropic or Gemini endpoint kinds (a library may supply them later, [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md) decision 5), streaming replies, vision and computer use, MCP servers for agents (v2 adds the org tools), summarising long contexts.

## Read first

[ADR 0014](../../adr/0014-model-endpoints-local-and-cloud.md), [ADR 0020](../../adr/0020-harness-adapter-kinds.md) (add the in-process kind in this package), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) (model endpoints row), the v0 WP4 pack for provenance rules, and in Michel `packages/harness/adapters/src/openai/`
(`client.ts` 362 lines, `session.ts` 479, `tools.ts` 493, `mcp.ts` 78), its test support `test/support/openai-fake.ts`, and `docs/adr/0023-openai-compatible-harness.md`. llama.cpp's `llama-server` documentation (`/v1/models`, `/v1/chat/completions`, `--jinja`, `--api-key`).

## Files

Create: `packages/harness/src/openai/{client.ts,session.ts,tools.ts}` (copied with provenance, changed as little as possible), `packages/node/src/endpoints.ts` (registry and probe), `packages/harness/test/openai-*.test.ts`, `packages/node/test/endpoints.test.ts`, `docs/research/openai-compatible-endpoints.md` (what was probed live).
Change: `packages/core/src/{config.ts,schema.ts}` (`endpoints` in node config, `aa_endpoint`, `aa_harness` gains `openai`), `packages/harness/src/registry.ts` (kind `in-process`), `docs/adr/0020-harness-adapter-kinds.md` (list the fourth kind), `THIRD_PARTY_NOTICES.md`, `docs/research/michel-reuse.md`, `apps/cli` (`agent create --harness openai --endpoint`, doctor).
Dependency: `@modelcontextprotocol/sdk` is **not** added in v1: drop `mcp.ts` and any import of it.

## Configuration and schema

```yaml
node:
  endpoints:
    - { id: llama-local, kind: openai_compatible, baseURL: "http://127.0.0.1:8080/v1" }
    - { id: lan-gpu,     kind: openai_compatible, baseURL: "http://192.168.1.20:8000/v1", keyEnv: LAN_GPU_KEY, models: [qwen3-32b] }
    - { id: cloud,       kind: openai_compatible, baseURL: "https://api.example.com/v1",  keyEnv: CLOUD_KEY, capabilities: { tools: true, json_schema: true } }
```

`aa_agent` gets `aa_endpoint` (text, an endpoint id from the node config); `aa_harness` gains `openai`; `aa_model` names the model. Schema version stays `0.2.0` (additive within v1). Keys are only environment variable names.

## Behaviour

1. **Registry** `resolveEndpoint(id, model)`: validates the endpoint exists on this node and the model is listed or probed; returns `{ baseURL, headers, capabilities }`. The same function will serve the decision model in v3 ([ADR 0014](../../adr/0014-model-endpoints-local-and-cloud.md) decision 5).
2. **Probe at node start and on demand**, cached for the process: `GET /v1/models` (reachable, model present); a minimal chat call with one trivial tool to set `tools`; a minimal call with `response_format` JSON schema to set `json_schema`. A declared capability in config overrides a probe. A probe failure marks the endpoint `unavailable` (retry after 60 s) and never crashes the node.
   An agent needing tools on an endpoint with `tools: false` is refused with the notice `The model <m> on <endpoint> cannot call tools (check llama-server --jinja and the chat template).`
3. **The loop** (copied `session.ts`): system prompt = the agent's instructions; user = the message; calls the model; executes tool calls through `tools.ts`; each tool call goes through `onPermission` → `decidePermission` (and, in `ask`, the gate), a denial returns the reason to the model as the tool result; stops at a final answer, at `maxSteps` (default 25), at a time limit, or on cancellation.
   Retries: 429 and 5xx with backoff (3 tries), then `HarnessError`. Output truncated to a configured size with a visible marker.
4. **Tools** (a small fixed set, no shell in `read_only`): `read_file`, `list_dir`, `grep`, and, outside `read_only`, `write_file`, `edit_file`, `run_command`. **Confinement:** every path is resolved against `aa_workdir` and the node's `workdirRoots`, symlinks are resolved before the check, `..` and absolute escapes are refused, and the v0 floor still applies. `fetch` and web tools do not exist in v1.
5. **Kind `in-process`:** the descriptor declares `permissionCallbacks: true`, `sessionResume: true` (the transcript is stored on the node under the agent's home and trimmed to a token budget), `streaming: false`, `auth: ['api_key']` (or none for a local endpoint). A turn's usage (tokens) is returned from the response's `usage`.
6. **`doctor`:** each endpoint reachable, the model present, the capabilities found, and any agent whose harness is `openai` has an endpoint on this node and a tool-capable model.
7. **Keys** never reach the model, the logs or the harness environment of other harnesses.

## Steps

1. Copy the three files with provenance, adapt imports, drop MCP, make Michel's `openai-client` and `openai-session` tests pass with `openai-fake.ts`.
2. Endpoint registry and probes against a fake server, including a server that answers tool calls badly.
3. Tools with confinement tests (symlink escape, `..`, absolute path, a path just outside the root with a shared prefix).
4. Wire the descriptor, `agent create --harness openai --endpoint`, schema and config.
5. Live pass (opt-in): `llama-server --jinja` with a small model that supports tools: a read task, a refused write in `read_only`, an approved write in `ask`; and one cloud endpoint. Record the model, the flags, what the probes returned and how the loop behaved in `docs/research/openai-compatible-endpoints.md`, including what did not work.
6. Update ADR 0020, notices and docs.

## Tests

- T-V1-WP5-01 config: endpoints validate (unique ids, https or loopback or private network allowed, a key only by env var name); unknown endpoint id on an agent is a clear error.
- T-V1-WP5-02 probe: `tools` and `json_schema` detected true and false from a fake server; a declared value overrides; an unreachable server marks `unavailable` and recovers.
- T-V1-WP5-03 loop: tool call, result, final answer; max steps; time limit; cancellation stops the loop and leaves no pending request.
- T-V1-WP5-04 permissions in the loop: `read_only` offers no write or run tools and refuses a forced call; `ask` goes to the gate; `full` allows; a denial reason reaches the model.
- T-V1-WP5-05 confinement: symlink to outside the root, `../`, absolute path, prefix-sharing sibling directory, a file in the floor list: all refused with the reason; a normal file inside works.
- T-V1-WP5-06 retries: 429 then success; 500 three times then `HarnessError`; a malformed tool call from the model returns an error result to the model once, then stops.
- T-V1-WP5-07 session resume: the second turn includes the stored transcript, trimmed to the budget; a changed model or endpoint starts a new transcript.
- T-V1-WP5-08 a key in the environment never appears in the request logs, the model's input, or any other harness's environment.
- T-V1-WP5-09 an agent with `tools: false` on its endpoint gets the one notice and nothing runs.
- T-V1-WP5-10 `doctor` reports each endpoint condition with the exact message.
- T-V1-WP5-11 (live, `ANYBOT_LIVE_LLAMA=1`) the llama-server scenario above.
- T-V1-WP5-12 (live, `ANYBOT_LIVE_OPENAI_COMPAT=1`) the cloud scenario.

## Checks

```bash
pnpm --filter @anybot/harness test && pnpm --filter @anybot/node test && pnpm --filter @anybot/core test
ANYBOT_LIVE_LLAMA=1 pnpm --filter @anybot/harness test      # or NOT RUN with reason
grep -rL "Copied from" packages/harness/src/openai                # expect: no output
pnpm check
```

## Achievements

- [ ] An agent on a local `llama-server` answers a read question and obeys `read_only`, `ask` and `full` (live, or NOT RUN with the reason, which blocks WP8).
- [ ] Capabilities are probed; an incapable model is refused with a clear notice.
- [ ] File tools cannot escape the working directory by any tested route.
- [ ] Copied code has provenance; no MCP dependency was added.

## Stop and ask when

A common local model cannot produce valid tool calls even with the right template (then record which models work and tell the owner what v1 can promise); the loop needs a streaming protocol the endpoint does not support; the cloud endpoint's terms restrict automated use.
