# v1 status ledger

The implementing agent updates this file as it works (same rules as [v0's ledger](../v0/STATUS.md)): one row per work package, evidence in the
blocks below, never a bare "done"; `NOT RUN (reason)` for anything not run.

| WP | Status | Branch / last commit | Owner of the work | Notes |
| --- | --- | --- | --- | --- |
| WP1 | done | `cursor/v1-wp1-carryover-gate-d30c` | cloud agent | ANY-12; ADR 0021 proposed (own gate); merged #10 |
| WP2 | done | `cursor/v1-wp2-approval-gate-d30c` | cloud agent | ApprovalBook + ask + Temporal gate; merged #11 |
| WP3 | done | `cursor/v1-wp3-approvals-anytype-d30c` | cloud agent | aa_approval + gateway reactions |
| WP4 | not started | | | |
| WP5 | not started | | | |
| WP6 | not started | | | |
| WP7 | not started | | | |
| WP8 | not started | | | |

Status values: `not started`, `in progress`, `blocked (reason)`, `done`.

## Decisions in force

- Default until owner answers ADR 0021: **own gate** (recommendation A). No `@temporalio/agent-harness*` dependency. Pins remain 1.24.0.

## Differences between the built interfaces and this pack

- Saved query `Approvals – Pending`: backend has no saved-query API in the port; skipped with doctor silence (list pending via `org.list` instead).
- Status-edit approvals: implemented when `modifiedById` is present; ignored when missing (spike 005 still NOT RUN live).

## Pins actually installed

Unchanged from v0: every `@temporalio/*` exact `1.24.0`. No agent-harness packages.

## Questions for the owner

- **WP1 / ADR 0021:** Accept outcome A (own gate)? Optionally allow a separate commit to move SDK pin off 1.24.0 now that adoption is deferred.

## Evidence

### WP1: carry-over and gate decision  (done, 2026-11-07)

Built:
- `docs/roadmap/v1/CARRYOVER.md`
- `scripts/harness-criteria.mjs`
- `test/fixtures/harness-criteria/*`, `test/harness-criteria.test.ts`
- `docs/adr/0021-approval-gate-implementation.md` (proposed)
- Research §9 "Evaluation at v1" note

Checks:
- `node scripts/harness-criteria.mjs --fixture test/fixtures/harness-criteria/harness-pass` → all PASS
- `node scripts/harness-criteria.mjs --latest` → C1/C2/C5 FAIL on 0.4.0; recommend own gate
- `node scripts/harness-criteria.mjs --check-carryover` → ok
- `pnpm exec vitest … test/harness-criteria.test.ts` → 6 passed
- `pnpm --filter @anyagent/e2e test` → 9 passed (v0 automated suite on post-#9 main)
- Live procedure → **NOT RUN** (same reasons as v0 REPORT)

Achievements:
- [x] CARRYOVER.md lists every open item from v0 with owner package
- [x] Six criteria evaluated with evidence; ADR 0021 written (**proposed**, awaiting owner)
- [x] Pins / AGENTS.md consistent (no change; own gate)
- [x] v0 e2e suite green on starting tip `eaa77ef`

Deviations: harness spike 021 not built (early exit on criteria 1/2/5).

### WP2: approval gate and ask mode  (done, 2026-11-07)

Built:
- `packages/workflows/src/core/{approval-book,approval}.ts`; own-core optional `approvals`
- `decidePermission` mode `ask`; schema/config `approvalTtlMinutes`; resolveConfig `mode-unsupported`
- Node `permissionClient` bridge; stub `createApproval`/`recordDecision` (filled in WP3)
- Tests T-V1-WP2-01..09, 11, 12; `spikes/006-agent-core/APPROVALS.md`

Checks: `pnpm check` PASS; merged #11

Achievements:
- [x] ask turn pauses on gated call; approve/deny/expiry Temporal paths
- [x] no allow without decision (Temporal fail / unknown / double / expiry)
- [x] responsive status/rotation while pending
- [x] events per approval measured (APPROVALS.md)
- [x] specs updated

### WP3: approvals in Anytype  (done, 2026-11-07)

Built:
- Schema `0.2.0`: `aa_approval` + `aa_settings.aa_approvers` + `aa_request_id`
- `resolveApprovers` (spike 011), `summariseAction` / `riskForKind`, `decideFromReactions` / `decideFromStatusEdit`
- Node `createApproval` / `recordDecision`; gateway `approvals` watcher + `TemporalDecisionClient`
- `init` upgrade path; doctor D13–D15
- Tests T-V1-WP3-01..11 (automated); T-V1-WP3-12 live **NOT RUN** (no throwaway Anytype)

Checks: `pnpm check` PASS locally (453 tests); CI pending

Achievements:
- [x] person decides ask via reaction path (MemoryBackend + Temporal e2e)
- [x] decision recorded on object + chat confirmation
- [x] schema upgrade additive/idempotent; schema.md matches
- [x] spike 011 table in CI; status-edit when modifier visible

Deviations: saved-query `Approvals – Pending` skipped (no port API); live T-V1-WP3-12 NOT RUN.
