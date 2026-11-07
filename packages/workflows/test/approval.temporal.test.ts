/**
 * T-V1-WP2-03..10 Temporal approval gate behaviours.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { decisionUpdate, permissionUpdate } from "../src/core/approval.js";
import { chatUpdate, closeSignal, rotationQuery, statusQuery } from "../src/core/own-core.js";
import type { ChatInput } from "../src/core/types.js";
import { Skipped, withTemporal } from "./support/temporal.js";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, "fixtures/approval-workflow.ts");

const baseInput = (key: string, text: string): ChatInput => ({
  key,
  chatId: "chat",
  messageId: key,
  authorId: "author",
  text,
});

describe("T-V1-WP2 approval gate (Temporal)", () => {
  it("T-V1-WP2-03 approve path", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const created: string[] = [];
        const decisions: Array<{ requestId: string; approved: boolean }> = [];
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-03",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async (i: { requestId: string }) => {
              created.push(i.requestId);
            },
            recordDecision: async (i: { requestId: string; approved: boolean }) => {
              decisions.push({ requestId: i.requestId, approved: i.approved });
            },
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-03-${Date.now()}`,
            taskQueue: "appr-03",
            args: [{ approvalTtlMs: 60_000 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 200));
          const permP = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "req-1",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
                summary: "edit file",
                risk: "medium",
              },
            ],
            updateId: "perm-1",
          });
          await new Promise((r) => setTimeout(r, 200));
          const st = await handle.query(statusQuery);
          expect(st.pendingApprovals?.some((p) => p.requestId === "req-1")).toBe(true);
          const rot = await handle.query(rotationQuery);
          expect(rot.idle).toBe(false);

          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "req-1", approved: true, decidedBy: "owner" }],
            updateId: "dec-1",
          });
          const result = await permP;
          expect(result.approved).toBe(true);
          expect(created).toEqual(["req-1"]);
          expect(decisions.some((d) => d.requestId === "req-1" && d.approved)).toBe(true);
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-04 deny path", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-04",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {},
            recordDecision: async () => {},
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-04-${Date.now()}`,
            taskQueue: "appr-04",
            args: [{ approvalTtlMs: 60_000 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 150));
          const permP = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "req-d",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
              },
            ],
            updateId: "perm-d",
          });
          await new Promise((r) => setTimeout(r, 150));
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "req-d", approved: false, decidedBy: "owner", reason: "nope" }],
            updateId: "dec-d",
          });
          const result = await permP;
          expect(result.approved).toBe(false);
          expect(result.reason).toMatch(/nope/);
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-05 expiry denies", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const expired: string[] = [];
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-05",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {},
            recordDecision: async (i: { requestId: string; expired?: boolean }) => {
              if (i.expired) expired.push(i.requestId);
            },
          },
        });
        const run = worker.run();
        try {
          // Use TestWorkflowEnvironment time skipping via short TTL + sleep in workflow
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-05-${Date.now()}`,
            taskQueue: "appr-05",
            args: [{ approvalTtlMs: 500 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 100));
          const result = await handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "req-e",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 400,
              },
            ],
            updateId: "perm-e",
          });
          expect(result.approved).toBe(false);
          expect(result.reason).toMatch(/expired/);
          expect(expired).toContain("req-e");
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-06 repeated permission same id", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        let creates = 0;
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-06",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {
              creates += 1;
            },
            recordDecision: async () => {},
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-06-${Date.now()}`,
            taskQueue: "appr-06",
            args: [{ approvalTtlMs: 60_000 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 150));
          const p1 = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "same",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
              },
            ],
            updateId: "perm-a",
          });
          const p2 = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "same",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
              },
            ],
            updateId: "perm-b",
          });
          await new Promise((r) => setTimeout(r, 200));
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "same", approved: true, decidedBy: "owner" }],
            updateId: "dec-same",
          });
          const [r1, r2] = await Promise.all([p1, p2]);
          expect(r1.approved).toBe(true);
          expect(r2.approved).toBe(true);
          expect(creates).toBe(1);
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-07 unknown decision fails; second decision ignored", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-07",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {},
            recordDecision: async () => {},
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-07-${Date.now()}`,
            taskQueue: "appr-07",
            args: [{ approvalTtlMs: 60_000 }],
          });
          let unknown = false;
          try {
            await handle.executeUpdate(decisionUpdate, {
              args: [{ requestId: "ghost", approved: true, decidedBy: "o" }],
              updateId: "dec-ghost",
            });
          } catch {
            unknown = true;
          }
          expect(unknown).toBe(true);

          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 100));
          const permP = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "r7",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
              },
            ],
            updateId: "perm-7",
          });
          await new Promise((r) => setTimeout(r, 100));
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "r7", approved: true, decidedBy: "o" }],
            updateId: "dec-7a",
          });
          // second decision should not throw
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "r7", approved: false, decidedBy: "x" }],
            updateId: "dec-7b",
          });
          expect((await permP).approved).toBe(true);
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-08 two simultaneous pending", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-08",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {},
            recordDecision: async () => {},
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-08-${Date.now()}`,
            taskQueue: "appr-08",
            args: [{ approvalTtlMs: 60_000 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 100));
          const p1 = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "a",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
                summary: "a",
              },
            ],
            updateId: "pa",
          });
          const p2 = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "b",
                toolName: "Bash",
                needsApproval: true,
                expiresInMs: 60_000,
                summary: "b",
              },
            ],
            updateId: "pb",
          });
          await new Promise((r) => setTimeout(r, 200));
          const st = await handle.query(statusQuery);
          expect(st.pendingApprovals?.map((p) => p.requestId).sort()).toEqual(["a", "b"]);
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "b", approved: false, decidedBy: "o", reason: "no" }],
            updateId: "db",
          });
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "a", approved: true, decidedBy: "o" }],
            updateId: "da",
          });
          expect((await p1).approved).toBe(true);
          expect((await p2).approved).toBe(false);
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-V1-WP2-09 status/close while pending", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "appr-09",
          workflowsPath,
          activities: {
            recordTurn: async () => {},
            createApproval: async () => {},
            recordDecision: async () => {},
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("approvalFixtureWorkflow", {
            workflowId: `appr-09-${Date.now()}`,
            taskQueue: "appr-09",
            args: [{ approvalTtlMs: 60_000 }],
          });
          const hold = handle.executeUpdate(chatUpdate, {
            args: [baseInput("hold", "slow")],
            updateId: "hold",
          });
          await new Promise((r) => setTimeout(r, 100));
          const permP = handle.executeUpdate(permissionUpdate, {
            args: [
              {
                requestId: "r9",
                toolName: "Edit",
                needsApproval: true,
                expiresInMs: 60_000,
              },
            ],
            updateId: "p9",
          });
          await new Promise((r) => setTimeout(r, 100));
          expect((await handle.query(statusQuery)).state).toBe("running");
          expect((await handle.query(rotationQuery)).idle).toBe(false);
          await handle.executeUpdate(decisionUpdate, {
            args: [{ requestId: "r9", approved: true, decidedBy: "o" }],
            updateId: "d9",
          });
          await permP;
          await hold;
          await handle.signal(closeSignal);
          await handle.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);
});
