/**
 * T-WP8-05 — interrupt / cancel path (activity cancellation → interrupted notice).
 * Full `kill -9` of `anybot run` child process: NOT RUN in CI (no long-lived child harness here);
 * covered by runTurn cancel + workflow failure notice mapping.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { createNodeActivities, NodeStore } from "@anyagent/node";
import type { TurnRequest } from "@anyagent/workflows";
import { chatUpdate, closeSignal } from "@anyagent/workflows";
import { ApplicationFailure } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER, startAcceptance, WORKFLOWS_PATH, waitUntil } from "../support/anybot-harness.js";
import { Skipped, withTemporal } from "../support/temporal.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T-WP8-05 kill / interrupt", () => {
  it("HarnessError mid-turn → one interrupted/harness notice; next message works", async ({
    skip,
  }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        // Rebuild worker with failing first turn
        await h.stop();

        const store = new NodeStore(join(h.dir, "n2.sqlite"));
        let n = 0;
        const base = createNodeActivities({
          store,
          backendForOrg: () => h.backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [h.dir],
          stateDir: h.dir,
        });
        const activities = {
          ...base,
          runTurn: async (req: TurnRequest) => {
            n += 1;
            if (n === 1) {
              throw ApplicationFailure.nonRetryable("simulated kill", "HarnessError");
            }
            return base.runTurn(req);
          },
        };
        const queue = `wp8-kill-${Date.now()}`;
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: queue,
          workflowsPath: WORKFLOWS_PATH,
          activities,
        });
        const run = worker.run();
        const handle = await env.client.workflow.start("AnyBot", {
          workflowId: `agent:space:kill-${h.agent.agentId}`,
          taskQueue: queue,
          args: [
            {
              orgId: "org",
              spaceId: "space",
              agentId: h.agent.agentId,
              nodeQueue: queue,
            },
          ],
        });
        try {
          const inbound = await h.backend.postAs(h.agent.chatId, OWNER, { text: "boom" });
          await handle.executeUpdate(chatUpdate, {
            args: [
              {
                key: `k-${inbound.id}`,
                chatId: h.agent.chatId,
                messageId: inbound.id,
                authorId: OWNER,
                text: "boom",
              },
            ],
            updateId: `k-${inbound.id}`,
          });
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 30 });
            return hist.some(
              (m) => m.authorId === h.backend.me && /harness reported an error/i.test(m.text),
            );
          });
          const notices = (await h.backend.chat.history(h.agent.chatId, { limit: 30 })).filter(
            (m) => m.authorId === h.backend.me && /harness reported an error/i.test(m.text),
          );
          expect(notices).toHaveLength(1);

          const inbound2 = await h.backend.postAs(h.agent.chatId, OWNER, { text: "ok-again" });
          await handle.executeUpdate(chatUpdate, {
            args: [
              {
                key: `k-${inbound2.id}`,
                chatId: h.agent.chatId,
                messageId: inbound2.id,
                authorId: OWNER,
                text: "ok-again",
              },
            ],
            updateId: `k-${inbound2.id}`,
          });
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 40 });
            return hist.some((m) => m.authorId === h.backend.me && /reply:ok-again/i.test(m.text));
          });
        } finally {
          await handle.signal(closeSignal);
          await handle.result();
          worker.shutdown();
          await run;
          store.close();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("documents process-level kill -9 as NOT RUN in CI", () => {
    // Placeholder so the pack lists the check; evidence in REPORT.md.
    expect(true).toBe(true);
  });
});
