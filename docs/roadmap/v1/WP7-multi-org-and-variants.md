# v1 WP7: two orgs, Temporal Cloud, self-hosted any-sync

**Goal.** One deployment serves two orgs (two spaces, each with its own agents) with nothing crossing between them, and the whole of v0's acceptance passes on a Temporal Cloud namespace and on a self-hosted any-sync network, by configuration only. This package includes **spike 012**.

**Depends on:** v0. **Unblocks:** WP8.

## Scope

In: the isolation tests and fixes for two orgs, `node.serves`, a deployment id on workflows and the "other starter" check, the Temporal connection builder (self-hosted and Cloud), the self-hosted network procedure and its checks, `doctor`.
Out: more than two orgs in the acceptance (the code is for N), orgs on different backends (needs `backend-any`), a Temporal namespace per org, per-org operating-system users.

## Read first

[ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md) (all of it), [ADR 0003](../../adr/0003-one-shared-temporal-one-workflow-per-agent.md) (the `temporal` block, update-with-start, "moving between self-hosted and Cloud loses execution history only"), [ADR 0012](../../adr/0012-any-anytype-sync-network.md),
[research/anytype-api.md](../../research/anytype-api.md) (self-hosted network facts, `anytype-cli` `--network-config`), `@temporalio/client` 1.24.0 connection options (TLS, `apiKey`), Temporal Cloud documentation for the namespace address and authentication, and the v0 packages `packages/{core,gateway,node}` and `apps/cli`.

## Files

Create: `packages/node/src/temporal-connection.ts`, `docs/research/self-hosted-any-sync.md`, `spikes/012-self-hosted-any-sync/README.md`, `e2e/test/two-orgs.test.ts`, `e2e/live/README-variants.md`, tests in each package.
Change: `packages/core/src/config.ts` (`temporal` block, `node.serves`), `packages/gateway/src/delivery.ts` (memo with the deployment id), `packages/node/src/worker.ts` (serves check), `apps/cli/src/checks/*` (doctor), `docs/SPIKES.md` (012), `docs/specs/agent-workflow.md`.

## Configuration

```yaml
temporal:
  address: "<host:port from the Cloud console or your server>"
  namespace: "<namespace>"
  tls: true                      # or { serverNameOverride?, serverRootCACertPath?, clientCertPathEnv?, clientKeyPathEnv? }
  apiKeyEnv: TEMPORAL_API_KEY    # Temporal Cloud API-key authentication (optional)
node:
  handle: my-laptop
  serves: [personal, work]       # org ids; default: every org in the file
```

Keys and certificate paths only by environment variable name. `tls: false` is allowed only for a loopback or private address (`doctor` warns otherwise).

## Behaviour

1. **Isolation** (ADR 0018 decision 3 to 5), each proved by a test: workflow ids use the space id; node queues are `node:<spaceId>:<handle>`; gateway cursors, delivered keys and loop counts are keyed by space id; an activity refuses work for an org not in `node.serves` with the notice `This node does not serve org <id>`;
   secrets (keys) are looked up per org; approvals, approvers and reactions of org A never affect org B; stopping, rotating or failing one org's supervisor leaves the other running.
2. **Deployment id:** a UUID created once in the state directory; every workflow the gateway starts carries it as a memo (`deployment`). `doctor` lists running `agent:<spaceId>:*` workflows for each org and **warns** when one has a different or missing deployment memo (another anyagent is waking the same agents).
   Workflows started by v0 have no memo and are reported as `unknown`, not as an error.
3. **Temporal connection** (`temporal-connection.ts`): builds the `Connection` options from the config (address, TLS, API key, namespace) once, for the gateway, the workflow worker, the node worker and the CLI. It never logs the key. Connection failure messages name the setting that is likely wrong (address, namespace, key, TLS).
4. **Temporal Cloud variant:** v0's automated and live acceptance, unchanged, run against a Cloud namespace. Note any behaviour that differs (limits, latency, update-with-start support) in `docs/research/self-hosted-any-sync.md`'s sibling section "Temporal Cloud" or a new research note; do not change workflow code to suit it without writing why.
5. **Self-hosted any-sync variant (spike 012):** run a private any-sync network (follow the any-sync deployment documentation; record each step), create bot accounts with `anytype auth create --network-config <file>`, run v0's acceptance on it, and prove the negative: an account on the production network (or another network) cannot join the space.
   `doctor` checks that every configured endpoint and the gateway see the same space id and members ([ADR 0012](../../adr/0012-any-anytype-sync-network.md) decision 2).
6. **Two-org acceptance:** one config with two orgs on one Temporal and one `anytype serve` (the account is a member of both spaces) or two (record which), each org with one agent; run the v0 checks for both, then the isolation checks above.

## Steps

1. Config schema: `temporal` block and `node.serves`, with tests.
2. The connection builder, with unit tests on the produced options and failure messages.
3. Isolation tests with two memory backends first (cheap, deterministic), then two mock servers as separate processes (`e2e/test/two-orgs.test.ts`).
4. Deployment id memo and the doctor check.
5. Spike 012: build and document the private network, run the acceptance, run the negative test. If it cannot be built in a reasonable time, document exactly what blocked it and mark NOT RUN.
6. Temporal Cloud run (needs a namespace and credentials supplied by the owner; otherwise NOT RUN).
7. Docs.

## Tests

- T-V1-WP7-01 config: the `temporal` block validates (TLS shapes, key by env name, `tls: false` only for loopback or private addresses), `node.serves` defaults to all orgs and rejects an unknown org id.
- T-V1-WP7-02 connection options: address, namespace, TLS material, and `apiKey` are passed through; no secret appears in an error or a log line.
- T-V1-WP7-03 isolation, two orgs: distinct workflow ids and queues for equal agent handles and node handles; messages in A never reach B; cursors are independent after a restart.
- T-V1-WP7-04 approvals cannot cross: an approver of A reacting on a message in B has no effect; a request in B is not visible to A's gateway.
- T-V1-WP7-05 an org whose backend is down for a minute does not delay the other; it catches up afterwards (no loss, no duplicate).
- T-V1-WP7-06 an activity for an org not in `serves` is refused with the notice.
- T-V1-WP7-07 deployment memo: workflows started by this deployment carry it; `doctor` warns for a different memo, reports `unknown` for none.
- T-V1-WP7-08 (live, `ANYAGENT_LIVE_TEMPORAL_CLOUD=1`) v0's acceptance on a Cloud namespace.
- T-V1-WP7-09 (live, `ANYAGENT_LIVE_SELFHOSTED_NET=1`) v0's acceptance on the self-hosted network, and an account from another network cannot join.
- T-V1-WP7-10 `doctor` per org: each check is prefixed with the org id and one org's failure does not hide the other's results.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/e2e test
ANYAGENT_LIVE_TEMPORAL_CLOUD=1 pnpm --filter @anyagent/e2e test       # or NOT RUN with reason
ANYAGENT_LIVE_SELFHOSTED_NET=1 pnpm --filter @anyagent/e2e test       # or NOT RUN with reason
pnpm check
```

## Achievements

- [ ] Two orgs on one deployment never mix, and each failure stays inside its org.
- [ ] The v0 acceptance passes on Temporal Cloud and on a self-hosted any-sync network (or each is NOT RUN with the reason, which blocks WP8).
- [ ] The cross-network negative test passes.
- [ ] `doctor` can tell another deployment is waking the same agents.
- [ ] Spike 012 and the Cloud notes record what differed and what did not.

## Stop and ask when

Temporal Cloud rejects update-with-start or the Schedules features v1 needs; the private any-sync network cannot be built from the public documentation; an account on another network can join the space (a security finding: stop and report).
