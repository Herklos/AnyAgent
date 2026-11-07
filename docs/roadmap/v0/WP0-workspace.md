# WP0: workspace, tooling, CI, pins

**Goal.** An empty but real monorepo: `pnpm install && pnpm check` is green locally and in CI, the engine pins are enforced by a
test, and Temporal workflow code can be bundled. Nothing product-specific yet.

**Depends on:** nothing. **Unblocks:** every other package.

## Scope

In: workspace layout, TypeScript and test tooling, lint and format, a docs link checker, a pin checker, CI.
Out: any product code, any dependency not listed here.

## Read first

[AGENTS.md](../../../AGENTS.md), [ADR 0010](../../adr/0010-reuse-michel-adapters-and-the-npm-harness.md) (pin rule), [ADR 0019](../../adr/0019-own-workflow-core-behind-a-seam.md),
[research/temporal-agent-harness.md](../../research/temporal-agent-harness.md) (why 1.24.0), [spikes/001-ts-sse](../../../spikes/001-ts-sse/README.md)
(the type-stripping pitfall: no TypeScript parameter properties in code run directly by Node).

## Files

Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc` (`22`), `biome.json`, `vitest.config.ts`,
`scripts/check-pins.mjs`, `scripts/docs-check.mjs`, `.github/workflows/ci.yml`, and for each of `packages/{core,backend,backend-anytype,admin,workflows,harness,gateway,node}`
and `apps/cli`, `e2e`: `package.json`, `tsconfig.json`, `src/index.ts` (one exported constant), `test/smoke.test.ts`.
Change: `AGENTS.md` (add a "Commands" section), `README.md` (a "Develop" section).
Must not change: anything under `docs/adr/`, `docs/specs/`, `spikes/`.

## Steps

1. **Root.** `package.json` is `private`, `"type": "module"`, `"packageManager": "pnpm@10.28.0"`, `engines.node ">=22.18"`, with scripts
   `build` (`tsc -b`), `typecheck`, `lint` (biome check), `test` (vitest run), `docs-check`, `check-pins`, and `check`
   (all of them in that order). `pnpm-workspace.yaml` lists `packages/*`, `apps/*`, `e2e`.
2. **TypeScript.** `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2023 target, `module`
   and `moduleResolution` `NodeNext`, `verbatimModuleSyntax`, `composite`. Each package `tsconfig.json` extends it, outputs to `dist/`,
   and references the packages it will depend on (add references as later packages need them). Install TypeScript pinned exactly.
3. **Package shape.** `type: module`, `exports` `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `files: ["dist"]`.
   `packages/workflows` also exposes `./workflows` (the file Temporal bundles; added in WP3).
4. **Tests.** Vitest at the root with one project per package. Test titles carry the id (`T-WP0-01 …`). Provide a helper
   `e2e/support/temporal.ts` later (WP3) that starts `TestWorkflowEnvironment.createLocal()` or reports "skipped: <reason>".
5. **Pins.** Install `@temporalio/{client,worker,workflow,activity,common,testing}` at exactly `1.24.0` in the packages that need them
   (workflows: `workflow`, `common`; node: `worker`, `activity`, `client`; gateway: `client`; e2e: `testing`, `worker`, `client`).
   `scripts/check-pins.mjs` fails if any `@temporalio/*` dependency in any `package.json` or in the lockfile resolves to anything but
   `1.24.0`, or if any `@temporalio/agent-harness*` package is present (Q20).
6. **Docs check.** `scripts/docs-check.mjs`: every relative Markdown link under `docs/`, `README.md`, `AGENTS.md` resolves to a file or
   directory; exit 1 listing the broken ones. (The same check is run by hand today.)
7. **CI.** `.github/workflows/ci.yml` on pull request and on push to `main`: Node 22, pnpm via `pnpm/action-setup`,
   `pnpm install --frozen-lockfile`, then `pnpm check`. A second job runs the Temporal tests; the SDK's
   `TestWorkflowEnvironment.createLocal()` downloads its own server (no `setup-temporal` action). Pin every
   third-party action to a commit SHA and record the SHAs in STATUS.md.
8. **Docs.** Add the commands to AGENTS.md and a short "Develop" section to the README (install, check, test, how to run only one package).

## Tests

- T-WP0-01 every package exports its constant and `pnpm -r typecheck` passes.
- T-WP0-02 `pnpm lint` and `pnpm docs-check` pass on the repository as it is.
- T-WP0-03 `bundleWorkflowCode` succeeds on a one-line workflow module in `packages/workflows` (proves the bundler works with this layout).
- T-WP0-04 `check-pins` passes on the real tree, and fails (tested with a temporary fixture directory) when a package asks for `@temporalio/worker@^1.25.0` or for `@temporalio/agent-harness`.
- T-WP0-05 `docs-check` fails on a fixture with a broken link.

## Checks (record each result in STATUS.md)

```bash
pnpm install --frozen-lockfile
pnpm check            # expect: exit 0
pnpm -r build         # expect: dist/ in every package
node scripts/check-pins.mjs   # expect: "ok: 1.24.0 everywhere"
git status --short    # expect: no untracked build output (dist/ is ignored)
```

## Achievements

- [ ] `pnpm check` is green locally and in CI, with the Temporal job either green or explicitly skipped with a reason.
- [ ] Every `@temporalio/*` package is exactly 1.24.0, enforced by a failing test if that changes.
- [ ] No package imports another package's `src/`; only built entry points.
- [ ] AGENTS.md and README describe the commands.

## Stop and ask when

pnpm or Node 22.18 is unavailable; `@temporalio/*@1.24.0` cannot be installed together with vitest or the bundler; a pinned action SHA cannot be verified.
