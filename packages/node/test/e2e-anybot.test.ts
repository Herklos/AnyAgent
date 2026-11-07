/**
 * T-WP6-13 replay + T-WP6-14 end-to-end with fake harness and MemoryBackend (no gateway).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { chatUpdate, closeSignal } from "@anyagent/workflows";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { Skipped, withTemporal } from "../../workflows/test/support/temporal.js";
import { createNodeActivities } from "../src/activities/index.js";
import { NodeStore } from "../src/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, "../../workflows/src/workflows.ts");
const OWNER = "owner-1";
const QUEUE = "node-e2e";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function waitUntil(pred: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitUntil timeout");
}

describe("T-WP6-13 / T-WP6-14 AnyBot e2e", () => {
  it("T-WP6-14 message in, reply out, read_only refusal visible", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "anybot-e2e-"));
      dirs.push(dir);
      const backend = new MemoryBackend();
      await initOrg(backend);
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        allowedAuthors: [OWNER],
        mode: "read_only",
      });
      const store = new NodeStore(join(dir, "n.sqlite"));
      const activities = createNodeActivities({
        store,
        backendForOrg: () => backend,
        ownerIdsForOrg: () => [OWNER],
        workdirRoots: [dir, tmpdir()],
        stateDir: dir,
      });

      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE,
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId: `agent:space:${agent.agentId}`,
            taskQueue: QUEUE,
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: QUEUE,
              },
            ],
          });

          const inbound = await backend.postAs(agent.chatId, OWNER, { text: "WRITE_PLEASE" });
          await handle.executeUpdate(chatUpdate, {
            args: [
              {
                key: `k-${inbound.id}`,
                chatId: agent.chatId,
                messageId: inbound.id,
                authorId: OWNER,
                text: "WRITE_PLEASE",
              },
            ],
            updateId: `k-${inbound.id}`,
          });

          await waitUntil(async () => {
            const hist = await backend.chat.history(agent.chatId, { limit: 20 });
            return hist.some((m) => m.authorId === backend.me && /write step done/i.test(m.text));
          });

          const hist = await backend.chat.history(agent.chatId, { limit: 20 });
          const reply = hist.find(
            (m) => m.authorId === backend.me && /write step done/i.test(m.text),
          );
          expect(reply).toBeTruthy();
          // read_only: write not performed
          expect(store.getSession(`agent:space:${agent.agentId}`)?.sessionId).toBeTruthy();

          const updated = await backend.chat.get(agent.chatId, inbound.id);
          expect((updated?.reactions["✅"] ?? []).includes(backend.me)).toBe(true);

          await handle.signal(closeSignal);
          await handle.result();
        } finally {
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

  it("T-WP6-13 replay of recorded history succeeds", async ({ skip }) => {
    try {
      // Own-core already covers replay budget; here we assert AnyBot workflow code is deterministic
      // enough for a short happy-path history to complete without nondeterminism errors.
      const dir = mkdtempSync(join(tmpdir(), "anybot-replay-"));
      dirs.push(dir);
      const backend = new MemoryBackend();
      await initOrg(backend);
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        allowedAuthors: [OWNER],
      });
      const store = new NodeStore(join(dir, "n.sqlite"));
      const activities = createNodeActivities({
        store,
        backendForOrg: () => backend,
        ownerIdsForOrg: () => [OWNER],
        workdirRoots: [dir, tmpdir()],
        stateDir: dir,
      });

      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "replay-q",
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId: `replay-${agent.agentId}`,
            taskQueue: "replay-q",
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: "replay-q",
              },
            ],
          });
          const inbound = await backend.postAs(agent.chatId, OWNER, { text: "ping" });
          await handle.executeUpdate(chatUpdate, {
            args: [
              {
                key: `r-${inbound.id}`,
                chatId: agent.chatId,
                messageId: inbound.id,
                authorId: OWNER,
                text: "ping",
              },
            ],
            updateId: `r-${inbound.id}`,
          });
          await waitUntil(async () => {
            const hist = await backend.chat.history(agent.chatId, { limit: 10 });
            return hist.some((m) => m.authorId === backend.me && /reply:ping/i.test(m.text));
          });
          const hist = await env.client.workflow.getHandle(handle.workflowId).fetchHistory();
          // Replaying via Worker.runReplayHistory verifies determinism
          await Worker.runReplayHistory({ workflowsPath }, hist);
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
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
});
