/**
 * T-WP8-06 — rotation: close + new run under same workflow id; session survives on node store.
 */
import { rmSync } from "node:fs";
import { createNodeActivities } from "@anyagent/node";
import { chatUpdate, closeSignal } from "@anyagent/workflows";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER, startAcceptance, WORKFLOWS_PATH, waitUntil } from "../support/anybot-harness.js";
import { Skipped, withTemporal } from "../support/temporal.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T-WP8-06 rotation", () => {
  it("close then new run; session id kept on node store; messages answered", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        try {
          await h.send(OWNER, "before-rot", "k1");
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 20 });
            return hist.some(
              (m) => m.authorId === h.backend.me && /reply:before-rot/i.test(m.text),
            );
          });
          const sessionBefore = h.store.getSession(h.workflowId)?.sessionId;
          expect(sessionBefore).toBeTruthy();

          await h.handle.signal(closeSignal);
          await h.handle.result();

          // New run, same workflow id, same store/activities.
          const queue = `wp8-rot2-${Date.now()}`;
          const activities = createNodeActivities({
            store: h.store,
            backendForOrg: () => h.backend,
            ownerIdsForOrg: () => [OWNER],
            workdirRoots: [h.dir],
            stateDir: h.dir,
          });
          const worker = await Worker.create({
            connection: env.nativeConnection,
            taskQueue: queue,
            workflowsPath: WORKFLOWS_PATH,
            activities,
          });
          const run = worker.run();
          const handle2 = await env.client.workflow.start("AnyBot", {
            workflowId: h.workflowId,
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
            const inbound = await h.backend.postAs(h.agent.chatId, OWNER, { text: "after-rot" });
            await handle2.executeUpdate(chatUpdate, {
              args: [
                {
                  key: `k-${inbound.id}`,
                  chatId: h.agent.chatId,
                  messageId: inbound.id,
                  authorId: OWNER,
                  text: "after-rot",
                },
              ],
              updateId: `k-${inbound.id}`,
            });
            await waitUntil(async () => {
              const hist = await h.backend.chat.history(h.agent.chatId, { limit: 40 });
              return hist.some(
                (m) => m.authorId === h.backend.me && /reply:after-rot/i.test(m.text),
              );
            });
            expect(h.store.getSession(h.workflowId)?.sessionId).toBeTruthy();
          } finally {
            await handle2.signal(closeSignal);
            await handle2.result();
            worker.shutdown();
            await run;
          }
        } finally {
          // first harness worker already stopped via signal
          try {
            h.worker.shutdown();
            await h.run;
          } catch {
            // ok
          }
          h.store.close();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 180_000);
});
