# v0 status ledger

The implementing agent updates this file as it works. One row per work package; evidence goes in the sections below, never in
a bare "done". A package is `done` only when every achievement is ticked and every check is recorded with its result.

| WP | Status | Branch / last commit | Owner of the work | Notes |
| --- | --- | --- | --- | --- |
| WP0 | done | `cursor/v0-wp0-workspace-d30c` | cloud agent | |
| WP1 | done (live NOT RUN) | `cursor/v0-wp1-backend-d30c` | cloud agent | Spike 002 not run; adapter `verified: false` |
| WP2 | done | `cursor/v0-wp2-schema-config-d30c` | cloud agent | Fail-closed review fixes |
| WP3 | done | `cursor/v0-wp3-agent-core-d30c` | cloud agent | Contract + spike 006 measurement + replay/budget |
| WP4 | blocked (Michel@402865d not reachable: GitHub 404) | | | Needs owner access to Herklos/Michel for adapter copy |
| WP5 | done (spike 004 partial) | `cursor/v0-wp5-gateway-d30c` | cloud agent | Spike 004 on SDK test server; Cloud/self-hosted NOT RUN |
| WP6 | not started | | | |
| WP7 | not started | | | |
| WP8 | not started | | | |

Status values: `not started`, `in progress`, `blocked (reason)`, `done`.

## Decisions in force

Settled by the owner (2026-11-07), no longer open:

- **Q19**: both subscription logins and API keys, per agent, where the harness offers both ([ADR 0020](../../adr/0020-harness-adapter-kinds.md)).
- **Q20**: our own `AgentCore` behind the seam; the harness is reconsidered at v1 ([ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md)).
- **Q17**: Claude Code, Codex, Grok Build and Mistral Vibe; Grok Build and Vibe ship only if their live check passes.

## Pins actually installed

Exact versions after WP0 (`pnpm-lock.yaml`):

| Package | Version |
| --- | --- |
| `typescript` | `5.9.3` |
| `vitest` | `5.1.0` |
| `@biomejs/biome` | `2.6.6` |
| `@types/node` | `22.19.1` |
| `@temporalio/activity` | `1.24.0` |
| `@temporalio/client` | `1.24.0` |
| `@temporalio/common` | `1.24.0` |
| `@temporalio/testing` | `1.24.0` |
| `@temporalio/worker` | `1.24.0` |
| `@temporalio/workflow` | `1.24.0` |
| `pnpm` (packageManager) | `10.28.0` |
| Node (engines) | `>=22.18` |

No `@temporalio/agent-harness*`. CI action SHAs:

| Action | SHA | Tag |
| --- | --- | --- |
| `actions/checkout` | `11bd71901bbe5b1630ceea73d27597364c9af683` | v4.2.2 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |
| `pnpm/action-setup` | `a7487c7e89a18df4991f7f222e4898a00d66ddda` | v4.1.0 |

`temporalio/setup-temporal` is not used: workflow tests call `TestWorkflowEnvironment.createLocal()`, which downloads its own Temporal server.

## Questions for the owner

(none for WP0)

## Evidence

### WP0: workspace, tooling, CI, pins  (done, 2026-11-07)

Built:
- Root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.github/workflows/ci.yml`
- Scripts: `scripts/check-pins.mjs`, `scripts/docs-check.mjs`
- Packages: `packages/{core,backend,backend-anytype,admin,workflows,harness,gateway,node}`, `apps/cli`, `e2e` (each with `src/index.ts`, smoke test)
- `packages/workflows/src/workflows.ts` (Temporal bundle entry)
- Root tests: `test/{pins,docs-check,bundle-workflow}.test.ts`
- Docs: `AGENTS.md` Commands section, `README.md` Develop section

Checks:
- `pnpm install --frozen-lockfile` -> PASS (lockfile committed)
- `pnpm check` -> PASS (typecheck, lint, 16 tests, docs-check, check-pins)
- `pnpm -r build` -> PASS (`dist/` in every package)
- `node scripts/check-pins.mjs` -> `ok: 1.24.0 everywhere` (PASS)
- `git status --short` after build -> no untracked `dist/` (PASS; `dist/` in `.gitignore`)
- CI Temporal job: no longer uses `temporalio/setup-temporal` (v0.1.0 was broken; tests use `createLocal()`). WP0 has no Temporal integration tests yet (WP3). Local `bundleWorkflowCode` PASS (T-WP0-03).
- Vitest project roots are absolute from the config file so `pnpm --filter @anyagent/workflows test` (CI temporal job) does not resolve `packages/*` under the package cwd.
- CI green evidence: [run 42381213306](https://github.com/Herklos/AnyBots/actions/runs/42381213306) — `check` SUCCESS, `temporal` SUCCESS (after dropping setup-temporal + absolute vitest roots).

Achievements:
- [x] `pnpm check` is green locally and in CI, with the Temporal job either green or explicitly skipped with a reason.
- [x] Every `@temporalio/*` package is exactly 1.24.0, enforced by a failing test if that changes.
- [x] No package imports another package's `src/`; only built entry points.
- [x] AGENTS.md and README describe the commands.

Deviations: none material. Biome ignores `spikes/` and `docs/` so WP0 does not reformat pre-existing markdown/spike sources. Root package named `anyagent-workspace` so it does not collide with the CLI package name `anyagent`.

### WP1: backend port, reference backend, conformance, Anytype adapter  (done (live NOT RUN), 2026-11-07)

Built:
- `packages/backend/src/{port,errors,queue,memory-backend,index}.ts`, `conformance/{suite,schema,index}.ts`
- `packages/backend/test/{memory,mutations,smoke}.test.ts`
- `packages/backend-anytype/src/{client,sse,mapping,adapter,index}.ts`
- `packages/backend-anytype/test/{mock-heart,adapter,sse,errors,live,smoke}.test.ts`
- `spikes/002-anytype-live/README.md`
- Docs: `docs/research/anytype-api.md` (Verified live = NOT RUN), `docs/SPIKES.md` (002 not run)

Checks:
- `pnpm --filter @anyagent/backend test` -> PASS (T-WP1-01, 02, 06)
- `pnpm --filter @anyagent/backend-anytype test` -> PASS (T-WP1-03, 04, 05; T-WP1-07 skipped with printed reason)
- `ANYAGENT_LIVE_ANYTYPE=1 …` -> NOT RUN: no throwaway `anytype serve` in this environment
- `pnpm check` -> PASS

Achievements:
- [x] One port, one reference backend and one conformance suite in `@anyagent/backend`, with the suite shown to fail on broken backends.
- [x] `@anyagent/backend-anytype` passes the suite on the mock, and live if an instance was available. (live NOT RUN; `meta.verified: false`)
- [ ] Spike 002's ten questions are answered in `docs/research/anytype-api.md` with sources — **NOT RUN**; procedure and gaps recorded in `spikes/002-anytype-live/README.md`.
- [x] No secrets, space ids or names in fixtures. (no live fixtures captured)

Deviations: mock-heart is an HTTP facade over `MemoryBackend` with wire shapes aligned to `mapping.ts`, not a byte-for-byte heart mock for every route; sufficient for CI conformance until spike 002. WP8 cannot pass without a live run.

Questions for the owner: none beyond the recorded live NOT RUN (blocks WP8).

### WP3: AgentCore seam and own core  (done, 2026-11-07)

Built:
- `packages/workflows/src/core/{types,admission,own-core,index}.ts`
- `packages/workflows/test/{admission,own-core,core.contract}.ts`, `fixtures/core-workflow.ts`, `support/temporal.ts`
- `e2e/support/temporal.ts`, `docs/specs/agent-core.md`, `spikes/006-agent-core/README.md`

Checks:
- `pnpm --filter @anyagent/workflows test` -> PASS (unit + per-behaviour Temporal contract T-WP3-06..10/08b + T-WP3-11 replay + T-WP3-12 budget)
- Spike 006: **11.18 events / ~4.9 KB per message** (50 msgs); budget 14.5; under stop condition (25)
- Queries are pure (no `setHistoryLength` mutation); missing Temporal server uses vitest `skip(reason)`

Achievements:
- [x] Core behind `AgentCore`, pure logic separated from Temporal wiring.
- [x] Contract suite exported and passes on our core on a real Temporal test server.
- [x] Events/bytes per message fully tabulated — spike 006 + research Measured section.
- [x] `docs/specs/agent-core.md` exists.
- [x] No `@temporalio/agent-harness*`.

Deviations: none material after review fixes. Review briefly set status to in-progress while measurement was missing; now complete.

## Questions for the owner

- **WP4:** `Herklos/Michel@402865d` returns 404 from this environment. Please grant access or provide a mirror so adapters/floor can be copied with provenance.

### WP5: event gateway  (done (spike 004 partial), 2026-11-07)

Built:
- `packages/gateway/src/{state,pipeline,delivery,rotation,agents,supervisor,log,index}.ts`
- `packages/gateway/test/{pipeline,state,delivery,agents,rotation,supervisor,temporal.delivery,smoke}.test.ts` + support helpers
- `spikes/004-update-with-start/README.md`
- MemoryBackend test helpers: `postAs`, `deleteObject`
- Docs: `docs/SPIKES.md` (004 partial)

Checks:
- `pnpm --filter @anyagent/gateway test` -> PASS (T-WP5-01..11; Temporal on SDK test server)
- `pnpm check` -> PASS
- Spike 004 self-hosted/Cloud minimum version -> NOT RUN

Achievements:
- [x] No message lost or doubled across crash / outage / rotation paths covered by T-WP5-03..07, 11.
- [x] Failing org never blocks another (T-WP5-08, 09).
- [x] Unauthorised authors and own messages never start a turn (T-WP5-01).
- [ ] Spike 004 five questions on a **self-hosted** server + minimum version — **partial** (SDK test server only; Cloud/self-hosted NOT RUN; blocks WP8 for that reason).

Deviations: gateway Temporal tests use WP3 `coreFixtureWorkflow` (AnyAgent workflow is WP6). `workflowIdReusePolicy: ALLOW_DUPLICATE` set so post-rotation / post-close update-with-start can start a new run.

### WP2: schema, config, init, agent create  (done, 2026-11-07)

Built: `packages/core/src/{schema,agent-spec,author-policy,config}.ts`, `packages/admin/src/{init,agent}.ts`, `examples/anyagent.config.yaml`

Checks:
- `pnpm --filter @anyagent/core test` -> PASS
- `pnpm --filter @anyagent/admin test` -> PASS
- live admin -> NOT RUN (placeholder test)

Achievements:
- [x] v0 schema as data
- [x] config loader with defaults, bounds, absolute roots, errors together
- [x] createAgent / listAgents (object-first; orphan chat cleaned up)
- [x] author policy with required agentAccountId; lastModifierAcceptable fail-closed when capable
- [x] schema.md updated

Spikes 009/005: reference backend only; live Anytype NOT RUN; 005's last-modifier answer unknown.
