import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { createNodeActivities, NodeStore } from "@anyagent/node";
import { chatUpdate, closeSignal } from "@anyagent/workflows";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKFLOWS_PATH = join(here, "../../packages/workflows/src/workflows.ts");
export const OWNER = "owner-1";
export const STRANGER = "stranger-2";

export async function waitUntil(
  pred: () => boolean | Promise<boolean>,
  ms = 30_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("waitUntil timeout");
}

export async function startAcceptance(
  env: TestWorkflowEnvironment,
  opts?: { rotateAfter?: number },
) {
  const dir = mkdtempSync(join(tmpdir(), "wp8-"));
  const backend = new MemoryBackend();
  await initOrg(backend);
  const agent = await createAgent(backend, {
    handle: "chief",
    harness: "fake",
    allowedAuthors: [OWNER],
    mode: "read_only",
    workdir: dir,
  });
  const store = new NodeStore(join(dir, "n.sqlite"));
  const activities = createNodeActivities({
    store,
    backendForOrg: () => backend,
    ownerIdsForOrg: () => [OWNER],
    workdirRoots: [dir, tmpdir()],
    stateDir: dir,
  });
  const queue = `wp8-${Date.now()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: queue,
    workflowsPath: WORKFLOWS_PATH,
    activities,
  });
  const run = worker.run();
  const workflowId = `agent:space:${agent.agentId}`;
  const handle = await env.client.workflow.start("AnyBot", {
    workflowId,
    taskQueue: queue,
    args: [
      {
        orgId: "org",
        spaceId: "space",
        agentId: agent.agentId,
        nodeQueue: queue,
      },
    ],
    ...(opts?.rotateAfter
      ? {
          // rotateAfter is AgentCore option — passed via fixture only; AnyBot uses default 1500.
        }
      : {}),
  });
  return {
    dir,
    backend,
    agent,
    store,
    worker,
    run,
    handle,
    queue,
    workflowId,
    async send(authorId: string, text: string, key?: string) {
      const inbound = await backend.postAs(agent.chatId, authorId, { text });
      const k = key ?? `k-${inbound.id}`;
      await handle.executeUpdate(chatUpdate, {
        args: [
          {
            key: k,
            chatId: agent.chatId,
            messageId: inbound.id,
            authorId,
            text,
          },
        ],
        updateId: k,
      });
      return inbound;
    },
    async stop() {
      try {
        await handle.signal(closeSignal);
        await handle.result();
      } catch {
        // may already be closed
      }
      worker.shutdown();
      await run;
      store.close();
    },
  };
}
