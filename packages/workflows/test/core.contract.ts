/**
 * Contract suite for AgentCore implementations. Export runCoreContract so another
 * implementation can be tested with the same checks.
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

const baseInput = (key: string, text: string): ChatInput => ({
  key,
  chatId: "chat",
  messageId: key,
  authorId: "author",
  text,
});

export async function runCoreContract(
  ctx: ContractCtx,
  assert: {
    equal: (a: unknown, b: unknown, msg?: string) => void;
    ok: (v: unknown, msg?: string) => void;
  },
): Promise<void> {
  const { env } = ctx;
  const turns: Array<{ key: string; turnNumber: number; started: number; ended: number }> = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "core-contract",
    workflowsPath: ctx.workflowsPath ?? join(here, "fixtures/core-workflow.ts"),
    activities: {
      recordTurn: async (input: { key: string; turnNumber: number; text: string }) => {
        const started = Date.now();
        turns.push({ key: input.key, turnNumber: input.turnNumber, started, ended: 0 });
        const idx = turns.length - 1;
        // tiny yield
        await new Promise((r) => setTimeout(r, 5));
        turns[idx]!.ended = Date.now();
      },
    },
  });

  const run = worker.run();
  try {
    const handle = await env.client.workflow.start("coreFixtureWorkflow", {
      workflowId: `core-${Date.now()}`,
      taskQueue: "core-contract",
      args: [{ rotateAfterAccepted: 1500 }],
    });

    // T-WP3-06 order, one at a time
    for (let i = 0; i < 10; i++) {
      await handle.executeUpdate(chatUpdate, {
        args: [baseInput(`k${i}`, `m${i}`)],
        updateId: `u-${i}`,
      });
    }
    await waitFor(() => turns.length >= 10, 15_000);
    assert.equal(turns.map((t) => t.turnNumber).join(","), "1,2,3,4,5,6,7,8,9,10", "turn order");
    for (let i = 1; i < turns.length; i++) {
      assert.ok(turns[i]!.started >= turns[i - 1]!.ended, "no overlap");
    }

    // T-WP3-07 duplicate updateId / key
    const before = turns.length;
    await handle.executeUpdate(chatUpdate, {
      args: [baseInput("dup", "x")],
      updateId: "same-update",
    });
    await waitFor(() => turns.length >= before + 1, 10_000);
    try {
      await handle.executeUpdate(chatUpdate, {
        args: [baseInput("dup2", "y")],
        updateId: "same-update",
      });
    } catch {
      // Temporal may reject repeated updateId
    }
    const adm = await handle.executeUpdate(chatUpdate, {
      args: [baseInput("dup", "again")],
      updateId: "other-update",
    });
    assert.equal(adm.disposition, "duplicate");

    // T-WP3-09 failing turn does not stop next
    const n0 = turns.length;
    await handle.executeUpdate(chatUpdate, {
      args: [baseInput("fail1", "fail")],
      updateId: "fail-1",
    });
    await handle.executeUpdate(chatUpdate, {
      args: [baseInput("ok-after", "ok")],
      updateId: "ok-after",
    });
    await waitFor(() => turns.some((t) => t.key === "ok-after"), 10_000);
    const st = await handle.query(statusQuery);
    assert.ok(st.failed >= 1, "failure counted");
    assert.ok(turns.length > n0, "continued");

    // T-WP3-10 status during slow turn
    const slowP = handle.executeUpdate(chatUpdate, {
      args: [baseInput("slow1", "slow")],
      updateId: "slow-1",
    });
    await waitFor(async () => (await handle.query(statusQuery)).state === "running", 5_000);
    const mid = await handle.query(statusQuery);
    assert.equal(mid.state, "running");
    const rot = await handle.query(rotationQuery);
    assert.ok(typeof rot.idle === "boolean");
    await slowP;

    // T-WP3-08 close
    await handle.executeUpdate(chatUpdate, {
      args: [baseInput("q1", "queued-before-close")],
      updateId: "q1",
    });
    await handle.signal(closeSignal);
    let closed = false;
    try {
      await handle.executeUpdate(chatUpdate, {
        args: [baseInput("after-close", "nope")],
        updateId: "after-close",
      });
    } catch {
      closed = true;
    }
    assert.ok(closed, "AgentClosed after close");
    await handle.result();
  } finally {
    worker.shutdown();
    await run;
  }
}

async function waitFor(pred: (() => boolean) | (() => Promise<boolean>), ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}
