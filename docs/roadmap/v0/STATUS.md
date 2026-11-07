# v0 status ledger

The implementing agent updates this file as it works. One row per work package; evidence goes in the sections below, never in
a bare "done". A package is `done` only when every achievement is ticked and every check is recorded with its result.

| WP | Status | Branch / last commit | Owner of the work | Notes |
| --- | --- | --- | --- | --- |
| WP0 | done | `cursor/v0-wp0-workspace-d30c` | cloud agent | |
| WP1 | not started | | | |
| WP2 | not started | | | |
| WP3 | not started | | | |
| WP4 | not started | | | |
| WP5 | not started | | | |
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
- CI Temporal job: no longer uses `temporalio/setup-temporal` (v0.1.0 was broken; tests use `createLocal()`). WP0 has no Temporal integration tests yet (WP3). Local `bundleWorkflowCode` PASS (T-WP0-03). Green CI achievement left unticked until a green Temporal job run is recorded.

Achievements:
- [ ] `pnpm check` is green locally and in CI, with the Temporal job either green or explicitly skipped with a reason.
- [x] Every `@temporalio/*` package is exactly 1.24.0, enforced by a failing test if that changes.
- [x] No package imports another package's `src/`; only built entry points.
- [x] AGENTS.md and README describe the commands.

Deviations: none material. Biome ignores `spikes/` and `docs/` so WP0 does not reformat pre-existing markdown/spike sources. Root package named `anyagent-workspace` so it does not collide with the CLI package name `anyagent`.
