/**
 * Projection workflow: write aa_next_run / aa_last_run via the node queue.
 * Deterministic — no Date, Math.random, I/O, or Node imports.
 */
import { proxyActivities } from "@temporalio/workflow";
import type { NodeActivities, ScheduleProjectionInput } from "./contracts.js";

export async function ScheduleProjection(input: ScheduleProjectionInput): Promise<void> {
  const acts = proxyActivities<Pick<NodeActivities, "writeScheduleProjection">>({
    taskQueue: input.nodeQueue,
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 3 },
  });
  await acts.writeScheduleProjection({
    orgId: input.orgId,
    spaceId: input.spaceId,
    scheduleObjectId: input.scheduleObjectId,
    ...(input.nextRunIso ? { nextRunIso: input.nextRunIso } : {}),
    ...(input.lastRunIso ? { lastRunIso: input.lastRunIso } : {}),
  });
}
