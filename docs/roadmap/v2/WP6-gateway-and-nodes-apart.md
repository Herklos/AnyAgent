# v2 WP6: the gateway and the nodes as separate processes

**Goal.** The gateway runs on one machine and each node on its own, all against the same Temporal; an agent runs on the node its `aa_node` names, can be moved by editing that field, and a node that is down produces a clear notice instead of a silent stall.
Includes **spike 008** (two nodes, one gateway, one space), **spike 010** (one account on two machines) and **spike 003** (what one `anytype serve` costs).

**Depends on:** WP1, WP5. **Unblocks:** WP7, WP8.

## Scope

In: the `gateway` and `node` commands, the control queue, dynamic node routing, node registration and heartbeat (`aa_node`), offline handling, protocol version checks, the placement guide, the three spikes.
Out: a high-availability gateway (Q12), Temporal namespaces per org, automatic agent placement or load balancing ([ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md): none), Windows nodes.

## Read first

[ARCHITECTURE.md](../../ARCHITECTURE.md) sections 1, 2 and 8 (components, placement, failure modes), [ADR 0003](../../adr/0003-one-shared-temporal-one-workflow-per-agent.md), [ADR 0011](../../adr/0011-event-gateway.md) (decisions 3, 4 and 8), [ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md), [specs/schema.md](../../specs/schema.md) (`aa_node`),
[specs/agent-workflow.md](../../specs/agent-workflow.md), [SPIKES.md](../../SPIKES.md) (003, 008, 010), Michel `docs/AUDIT.md` G39 (node trust in a shared namespace), and from v1 `apps/cli/src/run.ts`, `packages/node/src/worker.ts`.

## Files

Create: `apps/cli/src/{gateway.ts,node.ts}` (commands), `packages/node/src/{registration.ts,heartbeat.ts,protocol.ts}`, `packages/workflows/src/queues.ts`, `docs/PLACEMENT.md`, `spikes/{003-serve-cost,008-two-nodes,010-one-account-two-machines}/README.md`, tests, `e2e/test/two-nodes.test.ts`.
Change: `packages/workflows/src/{anybot-workflow.ts,contracts.ts}` (control queue, per-turn node queue, protocol version), `packages/node/src/{worker.ts,activities/*}`, `apps/cli/src/run.ts` (starts both), `docs/ARCHITECTURE.md` (placement), `docs/GETTING-STARTED.md` (two machines), `docs/specs/agent-workflow.md`, `docs/SPIKES.md`.

## Behaviour

1. **Commands:** `anybot gateway` (watchers, delivery, reconciler, rotation, the control-queue worker), `anybot node` (the node worker for each org it serves, registration, heartbeat), `anybot run` (both, for one machine). A shared config file may hold `gateway` and `node` sections; each command reads what it needs and `doctor` checks only that part.
2. **Queues:** workflow task queue `anybot` (served by the process that serves workflows: the gateway process); **control queue `anybot-control`** for read-only activities that must run before the agent's node is known: `resolveConfig`, `resolveSchedule`; **node queues** `node:<spaceId>:<handle>` for everything that writes or runs a harness: `markReceived`, `runTurn`, `deliver`, `createApproval`, `recordDecision`, `taskWrite`,
   `writeScheduleProjection`. `resolveConfig` returns the agent's node handle from `aa_node`; the workflow then creates its node-queue activity proxy for that turn. A node also serves the control queue if it has a read key (optional).
3. **`aa_node`:** `anybot node register <handle> [--org id]` creates the object (person-owned `aa_handle`, `aa_lifecycle` live). The node's heartbeat (activity-free, a plain loop writing as its first account) updates `aa_last_seen` at most every 5 minutes and `aa_harnesses` (names and versions found on the machine) and `aa_accounts` (handles it has endpoints for) when they change.
   A node refuses to start for an org whose `aa_node` for its handle does not exist (clear message with the register command) or is `retired`.
4. **Moving an agent:** edit `aa_node`. The next turn runs on the new node. The harness session is kept per node (the id lives in that node's store), so the first turn on the new node starts a new session; the node posts no notice for that, but the turn log records `session: new (node changed)`.
5. **Offline node:** `runTurn` and the other node activities have a **schedule-to-start timeout** `tuning.nodeStartTimeoutSec` (default 120). On that timeout the workflow posts, through the control path, one notice `Node <handle> is not responding.` The posting uses a node that can write as the agent's account if any other node has that endpoint, else the gateway posts nothing and logs
   (the gateway does not write, [ADR 0011](../../adr/0011-event-gateway.md) decision 4); `doctor` and `status` show the node offline when `aa_last_seen` is older than 15 minutes. The message is not retried automatically; the person resends or the node returns and a resend works.
6. **Protocol version:** `contracts.PROTOCOL_VERSION` (2). Every activity input carries it; a node refuses a different major with a non-retryable `VersionSkew` failure, and the workflow posts `Node <handle> runs an incompatible anybot version.` The gateway refuses to start workers against a namespace whose registered nodes report a different version (read from `aa_node`'s heartbeat field `aa_protocol`, added to the schema here as a node-written text).
7. **Trust:** every node holds a Temporal credential for the namespace and can in principle read other agents' workflow inputs (Michel G39). Print this in `doctor` once and in `docs/PLACEMENT.md`: **nodes of one deployment trust each other.**
8. **Placement guide** (`docs/PLACEMENT.md`): where to run what (gateway next to Temporal; nodes anywhere that can reach Temporal and their Anytype endpoints), which ports, which keys live where, the two-machine recipe, what breaks if a machine is down.

## The three spikes

- **003, cost of `anytype serve`:** measure resident memory, idle CPU and disk for one account and for three accounts on one machine with different data directories and listen addresses; record whether they can run side by side. Write numbers, not impressions.
- **010, one account on two machines:** can `anytype serve` for the **same** account run on two machines at once, or must a shared account be served by one remote `anytype serve` that nodes reach over the private network? The answer decides what the guide tells people to do for a shared account across nodes.
- **008, two nodes and one gateway:** run the WP8 story's skeleton across two real machines (or two containers): create the agents, move one, stop a node, restore it. Record the timings and every surprise.

## Steps

1. Split the commands and queues; keep `run` working; update `doctor` per command.
2. `resolveConfig` onto the control queue and the dynamic node queue in the workflow; tests with two worker processes.
3. Registration and heartbeat with tests (the heartbeat writes through the account's backend; a down backend does not crash the node).
4. Offline timeouts and notices; protocol version checks.
5. Spikes 003, 010, 008 (opt-in, real machines); write the READMEs with what was and was not proven.
6. `docs/PLACEMENT.md`, guide and architecture updates.

## Tests

- T-V2-WP6-01 queues: each activity is registered on exactly the queue the table names (assert from the worker setup); `resolveConfig` is not on a node queue.
- T-V2-WP6-02 (Temporal, two worker processes) an agent's turn runs on the node its `aa_node` names; editing `aa_node` moves the next turn; the old node receives nothing.
- T-V2-WP6-03 registration: `node register` creates the object; a node with no object refuses to start with the message; a retired node refuses; the heartbeat updates at most every 5 minutes and survives a backend outage.
- T-V2-WP6-04 offline: stop the node process; a message gets one `not responding` notice after the timeout and no duplicate; restart the node and a resend works.
- T-V2-WP6-05 version skew: a node with a different protocol major refuses with `VersionSkew` and the workflow posts the notice.
- T-V2-WP6-06 `anybot run` still starts both and passes v1's suite unchanged.
- T-V2-WP6-07 secrets: a node's process never needs another node's keys; the gateway's process never has any account's write key (inspect the config sections each command loads).
- T-V2-WP6-08 `status` and `doctor` show a node offline after 15 minutes without a heartbeat and print the trust sentence once.
- T-V2-WP6-09 (live, `ANYBOT_LIVE_TWO_MACHINES=1`) spike 008 on two machines.

## Checks

```bash
pnpm --filter @anybot/node test && pnpm --filter @anybot/workflows test && pnpm --filter anybot test && pnpm --filter @anybot/e2e test
ANYBOT_LIVE_TWO_MACHINES=1 pnpm --filter @anybot/e2e test      # or NOT RUN with reason
pnpm check
```

## Achievements

- [ ] The gateway and two nodes run on separate machines and the story's skeleton works across them.
- [ ] Moving an agent is an edit; a missing node is a clear notice, not a silent stall.
- [ ] Version skew is detected and reported.
- [ ] Spikes 003, 008 and 010 have written results, including what they did not prove.
- [ ] `docs/PLACEMENT.md` exists and the guide covers two machines.

## Stop and ask when

A shared account cannot be served on two machines and the owner expects it (spike 010); the Temporal dev server cannot serve remote nodes in the owner's setup; a node cannot post a notice for an agent whose account it has no endpoint for and no other node has it (the notice would be lost: decide who posts).
