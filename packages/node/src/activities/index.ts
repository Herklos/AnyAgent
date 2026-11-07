import type { Backend } from "@anyagent/backend";
import type { NodeStore } from "../store.js";
import { createCreateApproval } from "./create-approval.js";
import { createDeliver } from "./deliver.js";
import { createMarkReceived } from "./mark-received.js";
import { createRecordDecision } from "./record-decision.js";
import { createResolveConfig } from "./resolve-config.js";
import { createResolveSchedule } from "./resolve-schedule.js";
import { createRunTurn } from "./run-turn.js";
import { createWriteScheduleProjection } from "./write-schedule-projection.js";

export { createCreateApproval } from "./create-approval.js";
export { createDeliver, splitReply } from "./deliver.js";
export { createMarkReceived } from "./mark-received.js";
export { createRecordDecision } from "./record-decision.js";
export { createResolveConfig } from "./resolve-config.js";
export { createResolveSchedule } from "./resolve-schedule.js";
export { createRunTurn, HarnessUnavailable } from "./run-turn.js";
export {
  createScheduleControlActivities,
  scheduleControlFromClient,
} from "./schedule-control.js";
export { createWriteScheduleProjection } from "./write-schedule-projection.js";

export interface ActivityFactoryOpts {
  store: NodeStore;
  backendForOrg: (orgId: string) => Backend;
  ownerIdsForOrg: (orgId: string) => string[];
  workdirRoots: string[];
  stateDir: string;
  maxMessageChars?: number;
  modifierCapable?: boolean;
}

export function createNodeActivities(
  opts: ActivityFactoryOpts & {
    permissionClient?: import("./run-turn.js").PermissionWorkflowClient;
    approvalTtlMs?: number;
  },
) {
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
    runTurn: createRunTurn({
      store: opts.store,
      ...(opts.permissionClient ? { permissionClient: opts.permissionClient } : {}),
      ...(opts.approvalTtlMs !== undefined ? { approvalTtlMs: opts.approvalTtlMs } : {}),
    }),
    createApproval: createCreateApproval({ backendForOrg: opts.backendForOrg }),
    recordDecision: createRecordDecision({ backendForOrg: opts.backendForOrg }),
    resolveSchedule: createResolveSchedule({
      backendForOrg: opts.backendForOrg,
      ownerIdsForOrg: opts.ownerIdsForOrg,
    }),
    writeScheduleProjection: createWriteScheduleProjection({
      backendForOrg: opts.backendForOrg,
    }),
  };
}
