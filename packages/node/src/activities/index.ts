import type { Backend } from "@anyagent/backend";
import type { NodeStore } from "../store.js";
import { createDeliver } from "./deliver.js";
import { createMarkReceived } from "./mark-received.js";
import { createResolveConfig } from "./resolve-config.js";
import { createRunTurn } from "./run-turn.js";

export { createDeliver, splitReply } from "./deliver.js";
export { createMarkReceived } from "./mark-received.js";
export { createResolveConfig } from "./resolve-config.js";
export { createRunTurn, HarnessUnavailable } from "./run-turn.js";

export interface ActivityFactoryOpts {
  store: NodeStore;
  backendForOrg: (orgId: string) => Backend;
  ownerIdsForOrg: (orgId: string) => string[];
  workdirRoots: string[];
  stateDir: string;
  maxMessageChars?: number;
  modifierCapable?: boolean;
}

export function createNodeActivities(opts: ActivityFactoryOpts) {
  return {
    resolveConfig: createResolveConfig({
      backendForOrg: opts.backendForOrg,
      ownerIdsForOrg: opts.ownerIdsForOrg,
      workdirRoots: opts.workdirRoots,
      stateDir: opts.stateDir,
      ...(opts.modifierCapable !== undefined ? { modifierCapable: opts.modifierCapable } : {}),
    }),
    markReceived: createMarkReceived({ backendForOrg: opts.backendForOrg }),
    deliver: createDeliver({
      backendForOrg: opts.backendForOrg,
      store: opts.store,
      ...(opts.maxMessageChars !== undefined ? { maxMessageChars: opts.maxMessageChars } : {}),
    }),
    runTurn: createRunTurn({ store: opts.store }),
  };
}
