/**
 * Fixture workflow for AgentCore contract tests.
 * Handler behaviour is controlled by input text: "fail", "slow", otherwise ok.
 */
import { proxyActivities, sleep } from "@temporalio/workflow";
import { createOwnCore } from "../../src/core/own-core.js";
import type { ChatInput } from "../../src/core/types.js";

export interface RecordTurn {
  recordTurn(input: { key: string; turnNumber: number; text: string }): Promise<void>;
}

const acts = proxyActivities<RecordTurn>({
  startToCloseTimeout: "1 minute",
});

export async function coreFixtureWorkflow(opts?: { rotateAfterAccepted?: number }): Promise<void> {
  const core = createOwnCore(opts);
  await core.run(async (input: ChatInput, ctx) => {
    if (input.text === "slow") {
      await sleep("2 seconds");
    }
    await acts.recordTurn({ key: input.key, turnNumber: ctx.turnNumber, text: input.text });
    if (input.text === "fail") {
      throw new Error("turn failed");
    }
  });
}
