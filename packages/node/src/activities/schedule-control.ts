/**
 * Control-queue activities for ScheduleKick (run on the anybot workflow worker).
 */
import {
  type Admission,
  AGENT_WORKFLOW_TYPE,
  scheduleFiredUpdate,
  WORKFLOW_TASK_QUEUE,
  workflowIdFor,
} from "@anyagent/workflows";
import {
  type Client,
  type ScheduleClient,
  WithStartWorkflowOperation,
  type WorkflowClient,
} from "@temporalio/client";

export interface ScheduleControlDeps {
  workflow: WorkflowClient;
  schedule: ScheduleClient;
  /** Default workflow type for agent (AnyBot). */
  workflowType?: string;
  taskQueue?: string;
}

export function createScheduleControlActivities(deps: ScheduleControlDeps) {
  const workflowType = deps.workflowType ?? AGENT_WORKFLOW_TYPE;
  const taskQueue = deps.taskQueue ?? WORKFLOW_TASK_QUEUE;

  return {
    async deliverScheduleFired(input: {
      orgId: string;
      spaceId: string;
      agentId: string;
      nodeQueue: string;
      key: string;
      scheduleId: string;
    }): Promise<Admission> {
      const workflowId = workflowIdFor(input.spaceId, input.agentId);
      const startOp = new WithStartWorkflowOperation(workflowType, {
        workflowId,
        taskQueue,
        args: [
          {
            orgId: input.orgId,
            spaceId: input.spaceId,
            agentId: input.agentId,
            nodeQueue: input.nodeQueue,
          },
        ],
        workflowIdConflictPolicy: "USE_EXISTING",
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
      });
      const handle = await deps.workflow.startUpdateWithStart(scheduleFiredUpdate, {
        args: [{ key: input.key, scheduleId: input.scheduleId }],
        updateId: input.key,
        waitForStage: "ACCEPTED",
        startWorkflowOperation: startOp,
      });
      return (await handle.result()) as Admission;
    },

    async describeScheduleNext(input: {
      spaceId: string;
      scheduleObjectId: string;
    }): Promise<{ nextRunIso?: string }> {
      const scheduleId = `schedule:${input.spaceId}:${input.scheduleObjectId}`;
      try {
        const desc = await deps.schedule.getHandle(scheduleId).describe();
        const next = desc.info.nextActionTimes[0];
        return next ? { nextRunIso: next.toISOString() } : {};
      } catch {
        return {};
      }
    },
  };
}

export function scheduleControlFromClient(
  client: Client,
): ReturnType<typeof createScheduleControlActivities> {
  return createScheduleControlActivities({
    workflow: client.workflow,
    schedule: client.schedule,
  });
}
