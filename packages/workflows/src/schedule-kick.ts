/**
 * Tiny workflow: deliver scheduleFired to the owner agent, then project next/last.
 * Deterministic — no Date, Math.random, I/O, or Node imports.
 */
import {
  ApplicationFailure,
  proxyActivities,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import {
  SCHEDULE_PROJECTION_WORKFLOW,
  type ScheduleKickInput,
  WORKFLOW_TASK_QUEUE,
} from "./contracts.js";
import type { Admission } from "./core/types.js";

interface ScheduleControlActivities {
  deliverScheduleFired(i: {
    orgId: string;
    spaceId: string;
    agentId: string;
    nodeQueue: string;
    key: string;
    scheduleId: string;
  }): Promise<Admission>;
  describeScheduleNext(i: {
    spaceId: string;
    scheduleObjectId: string;
  }): Promise<{ nextRunIso?: string }>;
}

export async function ScheduleKick(
  input: ScheduleKickInput & { nodeQueue: string },
): Promise<void> {
  if (!input.scheduleId || !input.agentId || !input.nodeQueue) {
    throw ApplicationFailure.nonRetryable("BadInput", "BadInput");
  }
  const info = workflowInfo();
  const scheduled =
    input.scheduledTimeIso ||
    firstSearchAttr(info.searchAttributes?.TemporalScheduledStartTime) ||
    info.runId;
  const key = `${input.scheduleId}:${scheduled}`;

  const acts = proxyActivities<ScheduleControlActivities>({
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 5 },
    taskQueue: WORKFLOW_TASK_QUEUE,
  });

  await acts.deliverScheduleFired({
    orgId: input.orgId,
    spaceId: input.spaceId,
    agentId: input.agentId,
    nodeQueue: input.nodeQueue,
    key,
    scheduleId: input.scheduleId,
  });

  let nextRunIso: string | undefined;
  try {
    const next = await acts.describeScheduleNext({
      spaceId: input.spaceId,
      scheduleObjectId: input.scheduleId,
    });
    nextRunIso = next.nextRunIso;
  } catch {
    // Projection still writes last_run.
  }

  await startChild(SCHEDULE_PROJECTION_WORKFLOW, {
    workflowId: `proj:${input.spaceId}:${input.scheduleId}:${key}`,
    taskQueue: WORKFLOW_TASK_QUEUE,
    args: [
      {
        orgId: input.orgId,
        spaceId: input.spaceId,
        scheduleObjectId: input.scheduleId,
        nodeQueue: input.nodeQueue,
        lastRunIso: typeof scheduled === "string" ? scheduled : String(scheduled),
        ...(nextRunIso ? { nextRunIso } : {}),
      },
    ],
    parentClosePolicy: "ABANDON",
  });
}

function firstSearchAttr(v: unknown): string | undefined {
  if (Array.isArray(v) && v[0] != null) {
    const x = v[0];
    if (typeof x === "string") return x;
    if (typeof x === "number") return new Date(x).toISOString();
    // Temporal may pass Date-like ISO via payload.
    return String(x);
  }
  return undefined;
}
