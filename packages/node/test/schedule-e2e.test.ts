/**
 * T-V1-WP4-04/05/07/08 scheduleFired through AnyBot (Temporal test env).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { closeSignal, scheduleFiredUpdate } from "@anyagent/workflows";
import { Worker } from "@temporalio/worker";
import { afterEach, describe, expect, it } from "vitest";
import { Skipped, withTemporal } from "../../workflows/test/support/temporal.js";
import { createNodeActivities } from "../src/activities/index.js";
import { NodeStore } from "../src/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, "../../workflows/src/workflows.ts");
const OWNER = "owner-1";
const QUEUE = "node-sched-e2e";

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

describe("T-V1-WP4 scheduleFired e2e", () => {
  it("T-V1-WP4-04 fire runs turn with schedule body and 🕘 prefix", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "sched-ok-"));
      dirs.push(dir);
      mkdirSync(join(dir, "work"), { recursive: true });
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "full",
        allowedAuthors: [OWNER],
        workdir: join(dir, "work"),
      });
      const sched = await backend.objects.create("aa_schedule", {
        name: "standup",
        fields: {
          aa_owner: agent.agentId,
          aa_cron: "0 9 * * *",
          aa_timezone: "UTC",
          aa_enabled: true,
        },
        body: "WRITE_PLEASE",
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
        });
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

          const key = `${sched.id}:2026-11-07T09:00:00.000Z`;
          await handle.executeUpdate(scheduleFiredUpdate, {
            args: [{ key, scheduleId: sched.id }],
            updateId: key,
          });

          await waitUntil(async () => {
            const hist = await backend.chat.history(agent.chatId, { limit: 20 });
            return hist.some((m) => m.text.includes("🕘") && /standup/i.test(m.text));
          });

          const hist = await backend.chat.history(agent.chatId, { limit: 20 });
          const reply = hist.find((m) => m.text.includes("🕘"));
          expect(reply?.text.startsWith("🕘 standup")).toBe(true);

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

  it("T-V1-WP4-05 same key twice → one turn", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "sched-dup-"));
      dirs.push(dir);
      mkdirSync(join(dir, "work"), { recursive: true });
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "full",
        allowedAuthors: [OWNER],
        workdir: join(dir, "work"),
      });
      const sched = await backend.objects.create("aa_schedule", {
        name: "once",
        fields: {
          aa_owner: agent.agentId,
          aa_cron: "0 9 * * *",
          aa_timezone: "UTC",
          aa_enabled: true,
        },
        body: "hello schedule",
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
        });
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE + "-dup",
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId: `agent:space:${agent.agentId}`,
            taskQueue: QUEUE + "-dup",
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: QUEUE + "-dup",
              },
            ],
          });
          const key = `${sched.id}:same-occurrence`;
          // Distinct Temporal updateIds so the handler runs twice; admission dedupes on key.
          const a1 = await handle.executeUpdate(scheduleFiredUpdate, {
            args: [{ key, scheduleId: sched.id }],
            updateId: `${key}:kick-1`,
          });
          const a2 = await handle.executeUpdate(scheduleFiredUpdate, {
            args: [{ key, scheduleId: sched.id }],
            updateId: `${key}:kick-2`,
          });
          expect(a2.disposition).toBe("duplicate");
          expect(a1.turnNumber).toBe(a2.turnNumber);

          await waitUntil(async () => {
            const hist = await backend.chat.history(agent.chatId, { limit: 20 });
            return hist.filter((m) => m.text.includes("🕘")).length >= 1;
          });
          const hist = await backend.chat.history(agent.chatId, { limit: 20 });
          expect(hist.filter((m) => m.text.includes("🕘")).length).toBe(1);

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

  it("T-V1-WP4-08 paused agent: no turn", async ({ skip }) => {
    try {
      const dir = mkdtempSync(join(tmpdir(), "sched-pause-"));
      dirs.push(dir);
      const backend = new MemoryBackend();
      await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
      const agent = await createAgent(backend, {
        handle: "chief",
        harness: "fake",
        mode: "full",
      });
      await backend.objects.update(agent.agentId, { aa_lifecycle: "paused" });
      const sched = await backend.objects.create("aa_schedule", {
        name: "noop",
        fields: {
          aa_owner: agent.agentId,
          aa_cron: "0 9 * * *",
          aa_timezone: "UTC",
          aa_enabled: true,
        },
        body: "should not run",
      });
      const store = new NodeStore(join(dir, "n.sqlite"));

      await withTemporal(async (env) => {
        const activities = createNodeActivities({
          store,
          backendForOrg: () => backend,
          ownerIdsForOrg: () => [OWNER],
          workdirRoots: [dir, tmpdir()],
          stateDir: dir,
        });
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE + "-pause",
          workflowsPath,
          activities,
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("AnyBot", {
            workflowId: `agent:space:${agent.agentId}`,
            taskQueue: QUEUE + "-pause",
            args: [
              {
                orgId: "org",
                spaceId: "space",
                agentId: agent.agentId,
                nodeQueue: QUEUE + "-pause",
              },
            ],
          });
          const key = `${sched.id}:paused`;
          await handle.executeUpdate(scheduleFiredUpdate, {
            args: [{ key, scheduleId: sched.id }],
            updateId: key,
          });
          await new Promise((r) => setTimeout(r, 1500));
          const hist = await backend.chat.history(agent.chatId, { limit: 20 });
          expect(hist.some((m) => m.text.includes("🕘"))).toBe(false);

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
