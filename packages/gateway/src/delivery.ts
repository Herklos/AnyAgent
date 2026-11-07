import { type Admission, CHAT_UPDATE, type ChatInput } from "@anyagent/workflows";
import { type Client, WithStartWorkflowOperation, type WorkflowClient } from "@temporalio/client";
import { logGateway } from "./log.js";
import { sourceForChat } from "./pipeline.js";
import type { GatewayState } from "./state.js";

export interface DeliveryTarget {
  orgId: string;
  spaceId: string;
  agentId: string;
  nodeQueue: string;
  workflowType?: string;
  taskQueue?: string;
}

export interface DeliveryClient {
  deliverChat(target: DeliveryTarget, input: ChatInput): Promise<Admission>;
}

export class TemporalDeliveryClient implements DeliveryClient {
  constructor(private readonly workflow: WorkflowClient) {}

  static fromClient(client: Client): TemporalDeliveryClient {
    return new TemporalDeliveryClient(client.workflow);
  }

  async deliverChat(target: DeliveryTarget, input: ChatInput): Promise<Admission> {
    const workflowType = target.workflowType ?? "AnyAgent";
    const taskQueue = target.taskQueue ?? "anyagent";
    const workflowId = `agent:${target.spaceId}:${target.agentId}`;
    const startOp = new WithStartWorkflowOperation(workflowType, {
      workflowId,
      taskQueue,
      args: [
        {
          orgId: target.orgId,
          spaceId: target.spaceId,
          agentId: target.agentId,
          nodeQueue: target.nodeQueue,
        },
      ],
      workflowIdConflictPolicy: "USE_EXISTING",
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    });
    // waitForStage ACCEPTED: returns once the update is accepted, before the turn ends.
    await this.workflow.startUpdateWithStart(CHAT_UPDATE, {
      args: [input],
      updateId: input.key,
      waitForStage: "ACCEPTED",
      startWorkflowOperation: startOp,
    });
    return { disposition: "queued", turnNumber: 0 };
  }
}

export interface DeliverAndCommitOpts {
  state: GatewayState;
  client: DeliveryClient;
  target: DeliveryTarget;
  input: ChatInput;
  cursor?: string;
  chatId: string;
  eventCreatedAt?: string;
  sleep?: (ms: number) => Promise<void>;
}

function isClosedOrCompleted(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /AgentClosed|already completed|workflow execution already completed|workflow not found for|is closed/i.test(
    msg,
  );
}

/**
 * Deliver via update-with-start; only after acceptance commit cursor + mark delivered.
 * On AgentClosed / completed workflow, wait briefly and retry (update-with-start starts a new run).
 */
export async function deliverAndCommit(opts: DeliverAndCommitOpts): Promise<"ok" | "retried"> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const source = sourceForChat(opts.chatId);
  const eventAgeMs =
    opts.eventCreatedAt !== undefined ? Date.now() - Date.parse(opts.eventCreatedAt) : undefined;

  const attempt = async (): Promise<void> => {
    await opts.client.deliverChat(opts.target, opts.input);
    if (opts.cursor !== undefined) {
      opts.state.commitAndMarkDelivered(opts.target.spaceId, source, opts.cursor, opts.input.key);
    } else {
      opts.state.markDelivered(opts.target.spaceId, opts.input.key);
    }
  };

  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      await attempt();
      logGateway({
        org: opts.target.orgId,
        space: opts.target.spaceId,
        agent: opts.target.agentId,
        key: opts.input.key,
        outcome: i === 0 ? "delivered" : "delivered-after-retry",
        ...(eventAgeMs !== undefined && !Number.isNaN(eventAgeMs) ? { eventAgeMs } : {}),
      });
      return i === 0 ? "ok" : "retried";
    } catch (err) {
      lastErr = err;
      if (!isClosedOrCompleted(err) || i === 3) break;
      await sleep(50 * (i + 1));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  logGateway({
    org: opts.target.orgId,
    space: opts.target.spaceId,
    agent: opts.target.agentId,
    key: opts.input.key,
    outcome: "delivery-failed",
    error: msg.slice(0, 200),
  });
  throw lastErr;
}
