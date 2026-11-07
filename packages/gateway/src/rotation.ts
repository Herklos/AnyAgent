import { CLOSE_SIGNAL, ROTATION_QUERY, type RotationHint } from "@anyagent/workflows";
import type { WorkflowClient } from "@temporalio/client";
import { logGateway } from "./log.js";

export interface RotationClient {
  queryRotation(workflowId: string): Promise<RotationHint>;
  signalClose(workflowId: string): Promise<void>;
}

export class TemporalRotationClient implements RotationClient {
  constructor(private readonly workflow: WorkflowClient) {}

  async queryRotation(workflowId: string): Promise<RotationHint> {
    const handle = this.workflow.getHandle(workflowId);
    return handle.query(ROTATION_QUERY);
  }

  async signalClose(workflowId: string): Promise<void> {
    const handle = this.workflow.getHandle(workflowId);
    await handle.signal(CLOSE_SIGNAL);
  }
}

export interface MaybeRotateOpts {
  client: RotationClient;
  orgId: string;
  spaceId: string;
  agentId: string;
  rotateAfterAccepted?: number;
}

/**
 * Close an idle workflow when Temporal suggests continue-as-new or accepted >= threshold.
 * Never closes a non-idle workflow.
 */
export async function maybeRotate(opts: MaybeRotateOpts): Promise<boolean> {
  const workflowId = `agent:${opts.spaceId}:${opts.agentId}`;
  const threshold = opts.rotateAfterAccepted ?? 1500;
  let hint: RotationHint;
  try {
    hint = await opts.client.queryRotation(workflowId);
  } catch {
    return false;
  }
  const overThreshold = hint.accepted >= threshold || hint.continueAsNewSuggested;
  if (hint.idle && overThreshold) {
    await opts.client.signalClose(workflowId);
    logGateway({
      org: opts.orgId,
      space: opts.spaceId,
      agent: opts.agentId,
      outcome: "rotated",
      accepted: hint.accepted,
    });
    return true;
  }
  return false;
}
