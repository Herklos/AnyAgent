/**
 * Fixture workflow for approval-gate Temporal tests.
 */
import { proxyActivities, sleep } from "@temporalio/workflow";
import { createOwnCore } from "../../src/core/own-core.js";
import type { ChatInput } from "../../src/core/types.js";

export interface ApprovalFixtureActs {
  recordTurn(input: { key: string }): Promise<void>;
  createApproval(i: {
    requestId: string;
    toolName: string;
    summary: string;
    risk: string;
  }): Promise<void>;
  recordDecision(i: {
    requestId: string;
    approved: boolean;
    decidedBy: string;
    reason?: string;
    expired?: boolean;
  }): Promise<void>;
}

const acts = proxyActivities<ApprovalFixtureActs>({
  startToCloseTimeout: "1 minute",
});

export async function approvalFixtureWorkflow(opts?: {
  rotateAfterAccepted?: number;
  approvalTtlMs?: number;
}): Promise<void> {
  const core = createOwnCore({
    rotateAfterAccepted: opts?.rotateAfterAccepted ?? 1500,
    approvals: true,
    approvalTtlMs: opts?.approvalTtlMs ?? 30_000,
    approvalActivities: {
      createApproval: acts.createApproval,
      recordDecision: acts.recordDecision,
    },
  });
  await core.run(async (input: ChatInput) => {
    if (input.text === "slow") {
      await sleep("2 seconds");
    }
    await acts.recordTurn({ key: input.key });
  });
}
