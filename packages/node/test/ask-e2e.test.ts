/**
 * T-V1-WP3-05/06/07: ask mode end-to-end with MemoryBackend + Temporal + fake harness.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { chatUpdate, closeSignal, decisionUpdate } from "@anyagent/workflows";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { Skipped, withTemporal } from "../../workflows/test/support/temporal.js";
import { createNodeActivities } from "../src/activities/index.js";
import { TemporalPermissionClient } from "../src/permission-client.js";
import { NodeStore } from "../src/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, "../../workflows/src/workflows.ts");
const OWNER = "owner-1";
const QUEUE = "node-ask-e2e";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function waitUntil(pred: () => boolean | Promise<boolean>, ms = 45_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitUntil timeout");
}

describe("T-V1-WP3 ask e2e", () => {
  it("T-V1-WP3-05 approve lets the write happen", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "ask-ok-"));
      dirs.push(dir);
      const workdir = join(dir, "work");
      mkdirSync(workdir, { recursive: true });
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "ask",
        allowedAuthors: [OWNER],
        workdir,
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const permissionClient = TemporalPermissionClient.fromClient(env.client);
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
          permissionClient,
          approvalTtlMs: 120_000,
        });
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE,
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const workflowId = `agent:space:${agent.agentId}`;
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId,
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
          void handle.executeUpdate(chatUpdate, {
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
            const rows = await backend.org.list("aa_approval", { aa_status: "pending" });
            return rows.length > 0;
          });

          const pending = (await backend.org.list("aa_approval", { aa_status: "pending" }))[0]!;
          const requestId = String(pending.fields.aa_request_id);

          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId, approved: true, decidedBy: OWNER }],
            updateId: `decision:${requestId}`,
          });

          await waitUntil(async () => {
            const hist = await backend.chat.history(agent.chatId, { limit: 30 });
            return hist.some((m) => /write step done/i.test(m.text));
          });

          const approved = await backend.org.get(pending.id);
          expect(approved?.fields.aa_status).toBe("approved");
          expect(approved?.fields.aa_decided_by).toBe(OWNER);
          const out = readFileSync(join(workdir, "out.txt"), "utf8");
          expect(out).toBe("x");
          const hist = await backend.chat.history(agent.chatId, { limit: 30 });
          expect(hist.some((m) => /approved by owner-1/i.test(m.text))).toBe(true);

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

  it("T-V1-WP3-06 deny: no write, reason in reply", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "ask-deny-"));
      dirs.push(dir);
      const workdir = join(dir, "work");
      mkdirSync(workdir, { recursive: true });
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "ask",
        allowedAuthors: [OWNER],
        workdir,
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const permissionClient = TemporalPermissionClient.fromClient(env.client);
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
          permissionClient,
          approvalTtlMs: 120_000,
        });
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE + "-deny",
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const workflowId = `agent:space:${agent.agentId}`;
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId,
            taskQueue: QUEUE + "-deny",
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: QUEUE + "-deny",
              },
            ],
          });

          const inbound = await backend.postAs(agent.chatId, OWNER, { text: "WRITE_PLEASE" });
          void handle.executeUpdate(chatUpdate, {
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
            const rows = await backend.org.list("aa_approval", { aa_status: "pending" });
            return rows.length > 0;
          });
          const pending = (await backend.org.list("aa_approval", { aa_status: "pending" }))[0]!;
          const requestId = String(pending.fields.aa_request_id);

          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId, approved: false, decidedBy: OWNER, reason: "nope" }],
            updateId: `decision:${requestId}`,
          });

          await waitUntil(async () => {
            const row = await backend.org.get(pending.id);
            return row?.fields.aa_status === "denied";
          });

          expect(() => readFileSync(join(workdir, "out.txt"), "utf8")).toThrow();
          const hist = await backend.chat.history(agent.chatId, { limit: 30 });
          expect(hist.some((m) => /denied by owner-1/i.test(m.text))).toBe(true);

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

  it("T-V1-WP3-07 expiry denies and posts once", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "ask-exp-"));
      dirs.push(dir);
      const workdir = join(dir, "work");
      mkdirSync(workdir, { recursive: true });
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "ask",
        allowedAuthors: [OWNER],
        workdir,
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const permissionClient = TemporalPermissionClient.fromClient(env.client);
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
          permissionClient,
          approvalTtlMs: 800,
        });
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE + "-exp",
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const workflowId = `agent:space:${agent.agentId}`;
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId,
            taskQueue: QUEUE + "-exp",
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: QUEUE + "-exp",
              },
            ],
          });

          const inbound = await backend.postAs(agent.chatId, OWNER, { text: "WRITE_PLEASE" });
          void handle.executeUpdate(chatUpdate, {
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
            const rows = await backend.org.list("aa_approval", { aa_status: "pending" });
            return rows.length > 0;
          });
          const pending = (await backend.org.list("aa_approval", { aa_status: "pending" }))[0]!;

          await waitUntil(async () => {
            const row = await backend.org.get(pending.id);
            return row?.fields.aa_status === "expired";
          }, 30_000);

          expect(() => readFileSync(join(workdir, "out.txt"), "utf8")).toThrow();
          const hist = await backend.chat.history(agent.chatId, { limit: 30 });
          const notices = hist.filter((m) => /expired/i.test(m.text));
          expect(notices).toHaveLength(1);

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
