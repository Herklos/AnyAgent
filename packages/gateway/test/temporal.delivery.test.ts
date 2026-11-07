import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { CLOSE_SIGNAL, ROTATION_QUERY, STATUS_QUERY } from "@anyagent/workflows";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { deliverAndCommit, TemporalDeliveryClient } from "../src/delivery.js";
import { maybeRotate, TemporalRotationClient } from "../src/rotation.js";
import { GatewayState } from "../src/state.js";
import { startOrgSupervisor } from "../src/supervisor.js";
import { Skipped, withTemporal } from "./support/temporal.js";
import { waitFor } from "./support/wait.js";

async function runTemporal(
  skip: (reason?: string) => void,
  fn: (env: TestWorkflowEnvironment) => Promise<void>,
): Promise<void> {
  try {
    await withTemporal(fn);
  } catch (err) {
    if (err instanceof Skipped) {
      skip(err.message);
      return;
    }
    throw err;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, "../../workflows/test/fixtures/core-workflow.ts");
const OWNER = "owner-1";
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function db(): GatewayState {
  const dir = mkdtempSync(join(tmpdir(), "gw-tmp-"));
  dirs.push(dir);
  return new GatewayState(join(dir, "gateway.sqlite"));
}

describe("T-WP5 Temporal delivery", () => {
  it("T-WP5-05 ten messages arrive in order, once each", async ({ skip }) => {
    await runTemporal(skip, async (env) => {
      const turns: string[] = [];
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "gw-e2e",
        workflowsPath,
        activities: {
          recordTurn: async (input: { key: string; turnNumber: number; text: string }) => {
            turns.push(input.text);
          },
        },
      });
      const run = worker.run();
      try {
        const backend = new MemoryBackend();
        await initOrg(backend);
        const agent = await createAgent(backend, {
          handle: "e2e",
          harness: "claude-code",
          allowedAuthors: [OWNER],
        });
        const state = db();
        const delivery = TemporalDeliveryClient.fromClient(env.client);
        const supervisor = startOrgSupervisor({
          orgId: "org",
          spaceId: "space",
          backend,
          state,
          delivery,
          nodeQueue: "nq",
          ownerIds: [OWNER],
          workflowType: "coreFixtureWorkflow",
          taskQueue: "gw-e2e",
          sleep: async () => undefined,
        });
        await waitFor(() => supervisor.agents.has(agent.agentId), 10_000);

        for (let i = 0; i < 10; i++) {
          await backend.postAs(agent.chatId, OWNER, { text: `m${i}` });
        }
        await waitFor(() => turns.length >= 10, 60_000);
        expect(turns).toEqual([...Array(10)].map((_, i) => `m${i}`));
        // exactly once
        expect(new Set(turns).size).toBe(10);

        await supervisor.stop();
        state.close();
      } finally {
        worker.shutdown();
        await run;
      }
    });
  }, 120_000);

  it("T-WP5-06 AgentClosed: retry starts a new run; no loss or double (×20)", async ({ skip }) => {
    await runTemporal(skip, async (env) => {
      // Loop so a rare ordering cannot hide the ACCEPTED/AgentClosed loss bug.
      for (let round = 0; round < 20; round++) {
        const turns: string[] = [];
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: `gw-close-${round}`,
          workflowsPath,
          activities: {
            recordTurn: async (input: { key: string; text: string }) => {
              turns.push(input.text);
            },
          },
        });
        const run = worker.run();
        try {
          const state = db();
          const delivery = TemporalDeliveryClient.fromClient(env.client);
          const agentId = `agent-close-${round}`;
          const target = {
            orgId: "org",
            spaceId: "space",
            agentId,
            nodeQueue: "nq",
            workflowType: "coreFixtureWorkflow",
            taskQueue: `gw-close-${round}`,
          };
          await deliverAndCommit({
            state,
            client: delivery,
            target,
            input: {
              key: `chat:c:open-${round}`,
              chatId: "c",
              messageId: `open-${round}`,
              authorId: OWNER,
              text: "open",
            },
            cursor: String(round * 2 + 1),
            chatId: "c",
          });
          await waitFor(() => turns.includes("open"), 30_000);
          const handle = env.client.workflow.getHandle(`agent:space:${agentId}`);
          const closing = handle.signal(CLOSE_SIGNAL).then(() => handle.result());
          await new Promise((r) => setTimeout(r, 20));
          await deliverAndCommit({
            state,
            client: delivery,
            target,
            input: {
              key: `chat:c:after-${round}`,
              chatId: "c",
              messageId: `after-${round}`,
              authorId: OWNER,
              text: "after",
            },
            cursor: String(round * 2 + 2),
            chatId: "c",
          });
          await closing.catch(() => undefined);
          await waitFor(() => turns.includes("after"), 60_000);
          expect(
            turns.filter((t) => t === "after"),
            `round ${round}`,
          ).toHaveLength(1);
          expect(
            turns.filter((t) => t === "open"),
            `round ${round}`,
          ).toHaveLength(1);
          state.close();
        } finally {
          worker.shutdown();
          await run;
        }
      }
    });
  }, 600_000);

  it("T-WP5-07 rotation closes idle at threshold, never busy; next message works", async ({
    skip,
  }) => {
    await runTemporal(skip, async (env) => {
      const turns: string[] = [];
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "gw-rot",
        workflowsPath,
        activities: {
          recordTurn: async (input: { key: string; text: string }) => {
            if (input.text === "slow") {
              await new Promise((r) => setTimeout(r, 1500));
            }
            turns.push(input.text);
          },
        },
      });
      const run = worker.run();
      try {
        const state = db();
        const delivery = TemporalDeliveryClient.fromClient(env.client);
        const rotation = new TemporalRotationClient(env.client.workflow);
        const target = {
          orgId: "org",
          spaceId: "space",
          agentId: "agent-rot",
          nodeQueue: "nq",
          workflowType: "coreFixtureWorkflow",
          taskQueue: "gw-rot",
        };
        // Start with low rotate threshold via workflow args — fixture reads rotateAfterAccepted.
        // Delivery always passes org init args; fixture ignores unknown fields.
        // Use start with rotateAfterAccepted by delivering then querying.
        // Kick off workflow with low threshold via client.start then update.
        await env.client.workflow.start("coreFixtureWorkflow", {
          workflowId: `agent:space:agent-rot`,
          taskQueue: "gw-rot",
          args: [{ rotateAfterAccepted: 2 }],
        });

        await deliverAndCommit({
          state,
          client: delivery,
          target,
          input: {
            key: "chat:c:r1",
            chatId: "c",
            messageId: "r1",
            authorId: OWNER,
            text: "r1",
          },
          cursor: "1",
          chatId: "c",
        });
        await deliverAndCommit({
          state,
          client: delivery,
          target,
          input: {
            key: "chat:c:r2",
            chatId: "c",
            messageId: "r2",
            authorId: OWNER,
            text: "r2",
          },
          cursor: "2",
          chatId: "c",
        });
        await waitFor(() => turns.length >= 2, 30_000);

        // Busy: send slow then try rotate — should not close while running
        const slowP = deliverAndCommit({
          state,
          client: delivery,
          target,
          input: {
            key: "chat:c:slow",
            chatId: "c",
            messageId: "slow",
            authorId: OWNER,
            text: "slow",
          },
          cursor: "3",
          chatId: "c",
        });
        await new Promise((r) => setTimeout(r, 50));
        const busyHint = await env.client.workflow
          .getHandle(`agent:space:agent-rot`)
          .query(STATUS_QUERY);
        if (busyHint.state === "running") {
          const closedBusy = await maybeRotate({
            client: rotation,
            orgId: "org",
            spaceId: "space",
            agentId: "agent-rot",
            rotateAfterAccepted: 2,
          });
          expect(closedBusy).toBe(false);
        }
        await slowP;
        await waitFor(() => turns.includes("slow"), 30_000);

        // Idle + over threshold → rotate
        const closed = await maybeRotate({
          client: rotation,
          orgId: "org",
          spaceId: "space",
          agentId: "agent-rot",
          rotateAfterAccepted: 2,
        });
        expect(closed).toBe(true);
        await env.client.workflow.getHandle(`agent:space:agent-rot`).result();

        // Next message starts a new run (update-with-start)
        await deliverAndCommit({
          state,
          client: delivery,
          target,
          input: {
            key: "chat:c:after-rot",
            chatId: "c",
            messageId: "after-rot",
            authorId: OWNER,
            text: "after-rot",
          },
          cursor: "4",
          chatId: "c",
          sleep: async () => undefined,
        });
        await waitFor(() => turns.includes("after-rot"), 30_000);
        expect(turns.filter((t) => t === "after-rot")).toHaveLength(1);
        void ROTATION_QUERY;
        void CLOSE_SIGNAL;
        state.close();
      } finally {
        worker.shutdown();
        await run;
      }
    });
  }, 180_000);
});
