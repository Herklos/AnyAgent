import { join } from "node:path";
import type { Backend } from "@anyagent/backend";
import type { AnyagentConfig } from "@anyagent/core";
import { nodeQueueFor, WORKFLOW_TASK_QUEUE } from "@anyagent/workflows";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createNodeActivities } from "./activities/index.js";
import { NodeStore } from "./store.js";

export interface StartWorkersOpts {
  config: AnyagentConfig;
  backends: Map<string, Backend>;
  /** Absolute path to compiled workflows bundle entry (workflows.js). */
  workflowsPath: string;
  temporalAddress?: string;
  namespace?: string;
  permissionClient?: import("./activities/run-turn.js").PermissionWorkflowClient;
  approvalTtlMs?: number;
}

/**
 * Workflow worker on `anybot` + one node worker per org handle queue.
 */
export async function startWorkers(opts: StartWorkersOpts): Promise<{
  workflowWorker: Worker;
  nodeWorkers: Worker[];
  store: NodeStore;
  shutdown: () => Promise<void>;
}> {
  const connection = await NativeConnection.connect({
    address: opts.temporalAddress ?? opts.config.temporal.address,
  });
  const store = new NodeStore(join(opts.config.state.dir, "node.sqlite"));

  const backendForOrg = (orgId: string) => {
    const b = opts.backends.get(orgId);
    if (!b) throw new Error(`no backend for org ${orgId}`);
    return b;
  };
  const ownerIdsForOrg = (orgId: string) => {
    const org = opts.config.orgs.find((o) => o.id === orgId);
    return org?.owners ?? [];
  };

  // One activity set shared; org routing is inside each call via orgId.
  const activities = createNodeActivities({
    store,
    backendForOrg,
    ownerIdsForOrg,
    workdirRoots: opts.config.node.workdirRoots,
    stateDir: opts.config.state.dir,
    maxMessageChars: opts.config.tuning.maxMessageChars,
    ...(opts.permissionClient ? { permissionClient: opts.permissionClient } : {}),
    ...(opts.approvalTtlMs !== undefined ? { approvalTtlMs: opts.approvalTtlMs } : {}),
  });

  const workflowWorker = await Worker.create({
    connection,
    namespace: opts.namespace ?? opts.config.temporal.namespace,
    taskQueue: WORKFLOW_TASK_QUEUE,
    workflowsPath: opts.workflowsPath,
  });

  const nodeWorkers: Worker[] = [];
  for (const org of opts.config.orgs) {
    // WP7 run starts one queue per agent handle; until then poll node:<space>:<node.handle>.
    const w = await startNodeWorker({
      connection,
      namespace: opts.namespace ?? opts.config.temporal.namespace,
      spaceId: org.space,
      handle: opts.config.node.handle,
      activities,
    });
    nodeWorkers.push(w);
  }

  return {
    workflowWorker,
    nodeWorkers,
    store,
    shutdown: async () => {
      workflowWorker.shutdown();
      for (const w of nodeWorkers) w.shutdown();
      store.close();
      await connection.close();
    },
  };
}

/** Start a node worker for one agent handle (used by tests and WP7 run). */
export async function startNodeWorker(opts: {
  connection: NativeConnection;
  namespace: string;
  spaceId: string;
  handle: string;
  activities: ReturnType<typeof createNodeActivities>;
}): Promise<Worker> {
  return Worker.create({
    connection: opts.connection,
    namespace: opts.namespace,
    taskQueue: nodeQueueFor(opts.spaceId, opts.handle),
    activities: opts.activities,
  });
}

export { nodeQueueFor, WORKFLOW_TASK_QUEUE };
