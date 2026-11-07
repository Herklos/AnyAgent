/** Package marker for WP0 workspace smoke. */
export const NODE_PACKAGE = "@anyagent/node" as const;

export {
  type ActivityFactoryOpts,
  createDeliver,
  createMarkReceived,
  createNodeActivities,
  createResolveConfig,
  createRunTurn,
  HarnessUnavailable,
  splitReply,
} from "./activities/index.js";
export { NodeStore, type SessionRow } from "./store.js";
export { startNodeWorker, startWorkers } from "./worker.js";
