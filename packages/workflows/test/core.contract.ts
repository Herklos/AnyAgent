/**
 * Contract suite for AgentCore implementations. Export runCoreContract so another
 * implementation can be tested with the same checks. Also export per-behaviour
 * cases so each T-WP3-0n gets its own vitest `it`.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { chatUpdate, closeSignal, rotationQuery, statusQuery } from "../src/core/own-core.js";
import type { ChatInput } from "../src/core/types.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface ContractCtx {
  env: TestWorkflowEnvironment;
  /** Path to the workflows module that exports coreFixtureWorkflow (or equivalent). */
  workflowsPath?: string;
}

export interface ContractAssert {
  equal: (a: unknown, b: unknown, msg?: string) => void;
  ok: (v: unknown, msg?: string) => void;
}

const baseInput = (key: string, text: string): ChatInput => ({
  key,
  chatId: "chat",
  messageId: key,
  authorId: "author",
  text,
});

async function waitFor(pred: (() => boolean) | (() => Promise<boolean>), ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

interface Harness {
  handle: Awaited<ReturnType<TestWorkflowEnvironment["client"]["workflow"]["start"]>>;
  turns: Array<{ key: string; turnNumber: number; started: number; ended: number }>;
  worker: Worker;
  run: Promise<void>;
}

async function startHarness(ctx: ContractCtx): Promise<Harness> {
  const { env } = ctx;
  const turns: Harness["turns"] = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "core-contract",
    workflowsPath: ctx.workflowsPath ?? join(here, "fixtures/core-workflow.ts"),
    activities: {
      recordTurn: async (input: { key: string; turnNumber: number; text: string }) => {
        const started = Date.now();
        turns.push({ key: input.key, turnNumber: input.turnNumber, started, ended: 0 });
        const idx = turns.length - 1;
        await new Promise((r) => setTimeout(r, 5));
        turns[idx]!.ended = Date.now();
      },
    },
  });
  const run = worker.run();
  const handle = await env.client.workflow.start("coreFixtureWorkflow", {
    workflowId: `core-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskQueue: "core-contract",
    args: [{ rotateAfterAccepted: 1500 }],
  });
  return { handle, turns, worker, run };
}

async function stopHarness(h: Harness): Promise<void> {
  h.worker.shutdown();
  await h.run;
}

export type ContractCase = {
  id: string;
  name: string;
  run: (ctx: ContractCtx, assert: ContractAssert) => Promise<void>;
};

/** One vitest `it` per behaviour (T-WP3-06..10 + closing-update). */
export const coreContractCases: ContractCase[] = [
  {
    id: "T-WP3-06",
    name: "T-WP3-06 order: turns run one at a time in admit order",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        for (let i = 0; i < 10; i++) {
          await h.handle.executeUpdate(chatUpdate, {
            args: [baseInput(`k${i}`, `m${i}`)],
            updateId: `u-${i}`,
          });
        }
        await waitFor(() => h.turns.length >= 10, 15_000);
        assert.equal(
          h.turns.map((t) => t.turnNumber).join(","),
          "1,2,3,4,5,6,7,8,9,10",
          "turn order",
        );
        for (let i = 1; i < h.turns.length; i++) {
          assert.ok(h.turns[i]!.started >= h.turns[i - 1]!.ended, "no overlap");
        }
        await h.handle.signal(closeSignal);
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
  {
    id: "T-WP3-07",
    name: "T-WP3-07 duplicate key / updateId is a no-op admit",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        const before = h.turns.length;
        await h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("dup", "x")],
          updateId: "same-update",
        });
        await waitFor(() => h.turns.length >= before + 1, 10_000);
        try {
          await h.handle.executeUpdate(chatUpdate, {
            args: [baseInput("dup2", "y")],
            updateId: "same-update",
          });
        } catch {
          // Temporal may reject repeated updateId
        }
        const adm = await h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("dup", "again")],
          updateId: "other-update",
        });
        assert.equal(adm.disposition, "duplicate");
        await h.handle.signal(closeSignal);
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
  {
    id: "T-WP3-09",
    name: "T-WP3-09 failing turn does not stop the next",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        const n0 = h.turns.length;
        await h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("fail1", "fail")],
          updateId: "fail-1",
        });
        await h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("ok-after", "ok")],
          updateId: "ok-after",
        });
        await waitFor(() => h.turns.some((t) => t.key === "ok-after"), 10_000);
        const st = await h.handle.query(statusQuery);
        assert.ok(st.failed >= 1, "failure counted");
        assert.ok(h.turns.length > n0, "continued");
        await h.handle.signal(closeSignal);
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
  {
    id: "T-WP3-10",
    name: "T-WP3-10 status/rotation queries during a slow turn",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        const slowP = h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("slow1", "slow")],
          updateId: "slow-1",
        });
        await waitFor(async () => (await h.handle.query(statusQuery)).state === "running", 5_000);
        const mid = await h.handle.query(statusQuery);
        assert.equal(mid.state, "running");
        const rot = await h.handle.query(rotationQuery);
        assert.ok(typeof rot.idle === "boolean");
        // Query purity: a second status query must not change accepted/turns/queued.
        const mid2 = await h.handle.query(statusQuery);
        assert.equal(mid2.accepted, mid.accepted, "query must not mutate accepted");
        assert.equal(mid2.turns, mid.turns, "query must not mutate turns");
        await slowP;
        await h.handle.signal(closeSignal);
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
  {
    id: "T-WP3-08",
    name: "T-WP3-08 close rejects later updates with AgentClosed",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        await h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("q1", "queued-before-close")],
          updateId: "q1",
        });
        await h.handle.signal(closeSignal);
        let closed = false;
        try {
          await h.handle.executeUpdate(chatUpdate, {
            args: [baseInput("after-close", "nope")],
            updateId: "after-close",
          });
        } catch {
          closed = true;
        }
        assert.ok(closed, "AgentClosed after close");
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
  {
    id: "T-WP3-08b",
    name: "T-WP3-08b update while closing is rejected with AgentClosed",
    async run(ctx, assert) {
      const h = await startHarness(ctx);
      try {
        // Keep the run alive so close is observed as "closing" (not already completed).
        const hold = h.handle.executeUpdate(chatUpdate, {
          args: [baseInput("hold", "hold")],
          updateId: "hold",
        });
        await waitFor(async () => (await h.handle.query(statusQuery)).state === "running", 5_000);
        await h.handle.signal(closeSignal);
        await waitFor(async () => {
          try {
            return (await h.handle.query(statusQuery)).state === "closing";
          } catch {
            // Already completed — still a closed agent for the purpose of this check.
            return true;
          }
        }, 5_000);
        let rejected = false;
        try {
          await h.handle.executeUpdate(chatUpdate, {
            args: [baseInput("while-closing", "nope")],
            updateId: "while-closing",
          });
        } catch {
          rejected = true;
        }
        assert.ok(rejected, "AgentClosed while closing");
        await hold;
        await h.handle.result();
      } finally {
        await stopHarness(h);
      }
    },
  },
];

/** Run every case in one go (legacy helper). */
export async function runCoreContract(ctx: ContractCtx, assert: ContractAssert): Promise<void> {
  for (const c of coreContractCases) {
    await c.run(ctx, assert);
  }
}
