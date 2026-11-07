import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAgents } from "@anyagent/admin";
import {
  GatewayState,
  startGateway,
  TemporalDeliveryClient,
  TemporalRotationClient,
} from "@anyagent/gateway";
import { createNodeActivities, startNodeWorker, startWorkers } from "@anyagent/node";
import { nodeQueueFor } from "@anyagent/workflows";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { createBackends } from "./backends.js";
import { loadDiscoveredConfig } from "./config-discovery.js";
import { runGateChecks } from "./doctor/run-doctor.js";
import { error, info } from "./logging.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function cmdRun(opts: { config?: string }): Promise<number> {
  const { path, config } = loadDiscoveredConfig(opts.config);
  const backends = createBackends(config);
  const gate = await runGateChecks({
    config,
    configPath: path,
    backends,
    orgIds: config.orgs.map((o) => o.id),
  });
  if (!gate.ok) {
    for (const c of gate.checks) {
      if (c.severity === "fail") {
        process.stderr.write(`FAIL ${c.id}  ${c.message}\n`);
        if (c.fix) process.stderr.write(`     fix: ${c.fix}\n`);
      }
    }
    process.stderr.write("run refused: doctor gate D1–D4/D6 failed\n");
    return 1;
  }

  const workflowsPath = resolveWorkflowsPath();
  const workers = await startWorkers({
    config,
    backends,
    workflowsPath,
  });

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });
  const store = workers.store;
  const activities = createNodeActivities({
    store,
    backendForOrg: (orgId) => {
      const b = backends.get(orgId);
      if (!b) throw new Error(`no backend for ${orgId}`);
      return b;
    },
    ownerIdsForOrg: (orgId) => config.orgs.find((o) => o.id === orgId)?.owners ?? [],
    workdirRoots: config.node.workdirRoots,
    stateDir: config.state.dir,
    maxMessageChars: config.tuning.maxMessageChars,
  });
  const extraWorkers: Awaited<ReturnType<typeof startNodeWorker>>[] = [];
  for (const org of config.orgs) {
    const backend = backends.get(org.id)!;
    const agents = await listAgents(backend);
    for (const a of agents) {
      if (!a.spec) continue;
      extraWorkers.push(
        await startNodeWorker({
          connection,
          namespace: config.temporal.namespace,
          spaceId: org.space,
          handle: a.spec.handle,
          activities,
        }),
      );
    }
  }

  const temporalConn = await Connection.connect({ address: config.temporal.address });
  const client = new Client({ connection: temporalConn, namespace: config.temporal.namespace });
  const delivery = TemporalDeliveryClient.fromClient(client);
  const rotation = new TemporalRotationClient(client.workflow);
  const state = new GatewayState(join(config.state.dir, "gateway.sqlite"));

  const gateway = startGateway({
    state,
    delivery,
    rotation,
    workflowType: "AnyBot",
    taskQueue: "anybot",
    rotateAfterAccepted: config.tuning.rotateAfterAccepted,
    orgs: config.orgs.map((org) => {
      const backend = backends.get(org.id)!;
      return {
        orgId: org.id,
        spaceId: org.space,
        backend,
        nodeQueue: nodeQueueFor(org.space, config.node.handle),
        ownerIds: org.owners ?? [],
      };
    }),
  });

  info({ cmd: "run", config: path, orgs: config.orgs.map((o) => o.id) });
  process.stdout.write("anybot run: workers + gateway started\n");

  workers.workflowWorker.run().catch((err) => {
    error({ outcome: "workflow-worker-failed", error: String(err) });
  });
  for (const w of workers.nodeWorkers) {
    w.run().catch((err) => error({ outcome: "node-worker-failed", error: String(err) }));
  }
  for (const w of extraWorkers) {
    w.run().catch((err) => error({ outcome: "agent-worker-failed", error: String(err) }));
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    info({ cmd: "run", outcome: "shutdown", signal });
    const drain = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    await Promise.race([
      (async () => {
        await gateway.stop();
        for (const w of extraWorkers) w.shutdown();
        await workers.shutdown();
        await connection.close();
        temporalConn.close();
      })(),
      drain,
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise(() => {});
  return 0;
}

function resolveWorkflowsPath(): string {
  try {
    const req = import.meta.resolve("@anyagent/workflows/workflows");
    return fileURLToPath(req);
  } catch {
    return join(here, "../../../packages/workflows/dist/workflows.js");
  }
}
