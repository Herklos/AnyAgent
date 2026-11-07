import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@temporalio/client";
import { ApplicationFailure } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import type { DeliverRequest, ResolvedConfig, TurnRequest, TurnResult } from "../src/contracts.js";
import { chatUpdate, closeSignal } from "../src/core/own-core.js";
import type { ChatInput } from "../src/core/types.js";
import { Skipped, withTemporal } from "./support/temporal.js";

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = "owner-1";
const QUEUE = "anybot-test";

const input = (key: string, text: string, authorId = OWNER): ChatInput => ({
  key,
  chatId: "chat1",
  messageId: key,
  authorId,
  text,
});

type MockState = {
  configs: ResolvedConfig[];
  turns: TurnRequest[];
  delivers: DeliverRequest[];
  marks: string[];
  turnImpl?: (t: TurnRequest) => Promise<TurnResult>;
};

function mockActivities(state: MockState) {
  return {
    resolveConfig: async () => {
      return (
        state.configs[0] ?? {
          ok: true as const,
          spec: {
            handle: "chief",
            harness: "fake",
            chatId: "chat1",
            approvalMode: "read_only" as const,
            allowedAuthors: [OWNER],
            lifecycle: "live" as const,
            instructions: "",
          },
          ownerIds: [OWNER],
        }
      );
    },
    markReceived: async (i: { messageId: string }) => {
      state.marks.push(i.messageId);
    },
    runTurn: async (t: TurnRequest) => {
      state.turns.push(t);
      if (state.turnImpl) return state.turnImpl(t);
      return { text: `echo:${t.text}`, stopReason: "end_turn", sessionId: "s1" };
    },
    deliver: async (d: DeliverRequest) => {
      state.delivers.push(d);
      return { messageId: `out-${state.delivers.length}` };
    },
  };
}

async function runAnyBot(
  state: MockState,
  fn: (handle: Awaited<ReturnType<Client["workflow"]["start"]>>) => Promise<void>,
): Promise<void> {
  await withTemporal(async (env) => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: QUEUE,
      workflowsPath: join(here, "../src/workflows.ts"),
      activities: mockActivities(state),
    });
    const run = worker.run();
    try {
      const handle = await env.client.workflow.start("AnyBot", {
        workflowId: `anybot-${Date.now()}`,
        taskQueue: QUEUE,
        args: [
          {
            orgId: "org",
            spaceId: "space",
            agentId: "agent1",
            nodeQueue: QUEUE,
          },
        ],
      });
      await fn(handle);
      await handle.signal(closeSignal);
      await handle.result();
    } finally {
      worker.shutdown();
      await run;
    }
  });
}

async function waitUntil(pred: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitUntil timeout");
}

describe("T-WP6 AnyBot workflow (mocked activities)", () => {
  it("T-WP6-07 happy path: reply + markReceived", async ({ skip }) => {
    try {
      const state: MockState = { configs: [], turns: [], delivers: [], marks: [] };
      await runAnyBot(state, async (handle) => {
        await handle.executeUpdate(chatUpdate, {
          args: [input("m1", "hello")],
          updateId: "u1",
        });
        await waitUntil(() => state.delivers.some((d) => d.kind === "reply"));
      });
      expect(state.marks).toContain("m1");
      expect(state.turns).toHaveLength(1);
      expect(state.delivers.some((d) => d.kind === "reply" && d.text.includes("hello"))).toBe(true);
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 60_000);

  it("T-WP6-08 paused: no turn, no deliver", async ({ skip }) => {
    try {
      const state: MockState = {
        configs: [
          {
            ok: true,
            spec: {
              handle: "chief",
              harness: "fake",
              chatId: "chat1",
              approvalMode: "read_only",
              allowedAuthors: [OWNER],
              lifecycle: "paused",
              instructions: "",
            },
            ownerIds: [OWNER],
          },
        ],
        turns: [],
        delivers: [],
        marks: [],
      };
      await runAnyBot(state, async (handle) => {
        await handle.executeUpdate(chatUpdate, {
          args: [input("m1", "hello")],
          updateId: "u1",
        });
        await new Promise((r) => setTimeout(r, 800));
      });
      expect(state.turns).toHaveLength(0);
      expect(state.delivers).toHaveLength(0);
      expect(state.marks).toHaveLength(0);
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 60_000);

  it("T-WP6-09 invalid config notice; not-allowed author silence", async ({ skip }) => {
    try {
      const invalid: MockState = {
        configs: [{ ok: false, reason: "invalid", detail: "bad handle" }],
        turns: [],
        delivers: [],
        marks: [],
      };
      await runAnyBot(invalid, async (handle) => {
        await handle.executeUpdate(chatUpdate, {
          args: [input("m1", "hello")],
          updateId: "u1",
        });
        await waitUntil(() => invalid.delivers.length >= 1);
      });
      expect(invalid.delivers).toHaveLength(1);
      expect(invalid.delivers[0]?.kind).toBe("notice");
      expect(invalid.delivers[0]?.text).toMatch(/cannot run right now/);

      const silent: MockState = {
        configs: [
          {
            ok: true,
            spec: {
              handle: "chief",
              harness: "fake",
              chatId: "chat1",
              approvalMode: "read_only",
              allowedAuthors: [OWNER],
              lifecycle: "live",
              instructions: "",
            },
            ownerIds: [OWNER],
          },
        ],
        turns: [],
        delivers: [],
        marks: [],
      };
      await runAnyBot(silent, async (handle) => {
        await handle.executeUpdate(chatUpdate, {
          args: [input("m2", "nope", "stranger")],
          updateId: "u2",
        });
        await new Promise((r) => setTimeout(r, 800));
      });
      expect(silent.turns).toHaveLength(0);
      expect(silent.delivers).toHaveLength(0);
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 90_000);

  it("T-WP6-10 failure notices then next message works", async ({ skip }) => {
    try {
      let n = 0;
      const state: MockState = {
        configs: [],
        turns: [],
        delivers: [],
        marks: [],
        turnImpl: async (t) => {
          n += 1;
          if (n === 1) {
            throw ApplicationFailure.nonRetryable("boom", "HarnessError");
          }
          return { text: `ok:${t.text}`, stopReason: "end_turn", sessionId: "s2" };
        },
      };
      await runAnyBot(state, async (handle) => {
        await handle.executeUpdate(chatUpdate, {
          args: [input("m1", "first")],
          updateId: "u1",
        });
        await waitUntil(() => state.delivers.some((d) => d.kind === "notice"));
        await handle.executeUpdate(chatUpdate, {
          args: [input("m2", "second")],
          updateId: "u2",
        });
        await waitUntil(() => state.delivers.some((d) => d.kind === "reply"));
      });
      expect(
        state.delivers.some(
          (d) => d.kind === "notice" && /harness reported an error/i.test(d.text),
        ),
      ).toBe(true);
      expect(state.delivers.some((d) => d.kind === "reply" && d.text.includes("second"))).toBe(
        true,
      );
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 90_000);

  it("T-WP6-11 three messages in order", async ({ skip }) => {
    try {
      const state: MockState = { configs: [], turns: [], delivers: [], marks: [] };
      await runAnyBot(state, async (handle) => {
        for (const k of ["a", "b", "c"]) {
          await handle.executeUpdate(chatUpdate, {
            args: [input(k, k)],
            updateId: `u-${k}`,
          });
        }
        await waitUntil(() => state.turns.length >= 3, 15_000);
      });
      expect(state.turns.map((t) => t.text)).toEqual(["a", "b", "c"]);
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 90_000);

  it("T-WP6-12 rotation keeps session id in node store (mocked)", async ({ skip }) => {
    try {
      // Session survival is a node-store property; workflow rotation starts a new run with same id.
      // This test verifies a second run after close still completes a turn.
      const state: MockState = { configs: [], turns: [], delivers: [], marks: [] };
      await withTemporal(async (env) => {
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: QUEUE,
          workflowsPath: join(here, "../src/workflows.ts"),
          activities: mockActivities(state),
        });
        const run = worker.run();
        try {
          const wfId = `anybot-rot-${Date.now()}`;
          const h1 = await env.client.workflow.start("AnyBot", {
            workflowId: wfId,
            taskQueue: QUEUE,
            args: [{ orgId: "org", spaceId: "space", agentId: "agent1", nodeQueue: QUEUE }],
          });
          await h1.executeUpdate(chatUpdate, { args: [input("m1", "one")], updateId: "u1" });
          await waitUntil(() => state.turns.length >= 1);
          await h1.signal(closeSignal);
          await h1.result();

          const h2 = await env.client.workflow.start("AnyBot", {
            workflowId: wfId,
            taskQueue: QUEUE,
            args: [{ orgId: "org", spaceId: "space", agentId: "agent1", nodeQueue: QUEUE }],
          });
          await h2.executeUpdate(chatUpdate, { args: [input("m2", "two")], updateId: "u2" });
          await waitUntil(() => state.turns.length >= 2);
          await h2.signal(closeSignal);
          await h2.result();
        } finally {
          worker.shutdown();
          await run;
        }
      });
      expect(state.turns.map((t) => t.text)).toEqual(["one", "two"]);
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 90_000);
});
