/** Package marker for WP0 workspace smoke. */
export const NODE_PACKAGE = "@anyagent/node" as const;

export {
  type ActivityFactoryOpts,
  createCreateApproval,
  createDeliver,
  createMarkReceived,
  createNodeActivities,
  createRecordDecision,
  createResolveConfig,
  createRunTurn,
  HarnessUnavailable,
  splitReply,
} from "./activities/index.js";
export { TemporalPermissionClient } from "./permission-client.js";
export { NodeStore, type SessionRow } from "./store.js";
export { startNodeWorker, startWorkers } from "./worker.js";
