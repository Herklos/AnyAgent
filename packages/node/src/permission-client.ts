import {
  PERMISSION_UPDATE,
  type PermissionUpdateInput,
  type PermissionUpdateResult,
} from "@anyagent/workflows";
import type { Client, WorkflowClient } from "@temporalio/client";
import type { PermissionWorkflowClient } from "./activities/run-turn.js";

/**
 * Activity → workflow bridge for ask-mode permission updates.
 */
export class TemporalPermissionClient implements PermissionWorkflowClient {
  constructor(private readonly workflow: WorkflowClient) {}

  static fromClient(client: Client): TemporalPermissionClient {
    return new TemporalPermissionClient(client.workflow);
  }

  async executePermission(
    workflowId: string,
    input: PermissionUpdateInput,
  ): Promise<PermissionUpdateResult> {
    const handle = this.workflow.getHandle(workflowId);
    return handle.executeUpdate(PERMISSION_UPDATE, {
      args: [input],
      updateId: `permission:${input.requestId}`,
    });
  }
}
