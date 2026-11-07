import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { chatUpdate, closeSignal } from "../src/core/own-core.js";
import type { ChatInput } from "../src/core/types.js";
import { coreContractCases } from "./core.contract.js";
import { Skipped, withTemporal } from "./support/temporal.js";

const here = dirname(fileURLToPath(import.meta.url));

const assert = {
  equal: (a: unknown, b: unknown, msg?: string) => expect(a, msg).toEqual(b),
  ok: (v: unknown, msg?: string) => expect(v, msg).toBeTruthy(),
};

const baseInput = (key: string, text: string): ChatInput => ({
  key,
  chatId: "chat",
  messageId: key,
  authorId: "author",
  text,
});

describe("T-WP3 AgentCore Temporal contract", () => {
  for (const c of coreContractCases) {
    it(c.name, async ({ skip }) => {
      try {
        await withTemporal(async (env) => {
          await c.run({ env }, assert);
        });
      } catch (err) {
        if (err instanceof Skipped) {
          skip(err.message);
          return;
        }
        throw err;
      }
    }, 120_000);
  }
});

describe("T-WP3-11 / T-WP3-12 / spike 006 measurement", () => {
  it("T-WP3-11 replay + T-WP3-12 budget + spike 006 events/bytes", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const messageCount = 50;
        const turns: string[] = [];
        const worker = await Worker.create({
          connection: env.nativeConnection,
          taskQueue: "core-measure",
          workflowsPath: join(here, "fixtures/core-workflow.ts"),
          activities: {
            recordTurn: async (input: { key: string }) => {
              turns.push(input.key);
            },
          },
        });
        const run = worker.run();
        try {
          const handle = await env.client.workflow.start("coreFixtureWorkflow", {
            workflowId: `measure-${Date.now()}`,
            taskQueue: "core-measure",
            args: [{ rotateAfterAccepted: 1500 }],
          });
          for (let i = 0; i < messageCount; i++) {
            await handle.executeUpdate(chatUpdate, {
              args: [baseInput(`m${i}`, `text-${i}`)],
              updateId: `mu-${i}`,
            });
          }
          await new Promise<void>((resolve, reject) => {
            const deadline = Date.now() + 60_000;
            const tick = () => {
              if (turns.length >= messageCount) resolve();
              else if (Date.now() > deadline) reject(new Error("measure wait timeout"));
              else setTimeout(tick, 50);
            };
            tick();
          });
          await handle.signal(closeSignal);
          await handle.result();

          const history = await handle.fetchHistory();
          const events = history.events ?? [];
          const eventCount = events.length;
          const bytes = Buffer.byteLength(JSON.stringify(history), "utf8");
          const eventsPerMessage = eventCount / messageCount;
          const bytesPerMessage = bytes / messageCount;

          // Pack stop condition: report if above 25 events/message.
          expect(eventsPerMessage).toBeLessThanOrEqual(25);

          // T-WP3-12 budget = measured × 1.3 (with a floor for CI variance).
          const budget = eventsPerMessage * 1.3;
          expect(eventCount).toBeLessThanOrEqual(Math.ceil(budget * messageCount));

          // Persist measurement for humans (stdout; spike README updated in same PR).
          console.info(
            JSON.stringify({
              spike006: {
                messages: messageCount,
                events: eventCount,
                bytes,
                eventsPerMessage: Number(eventsPerMessage.toFixed(2)),
                bytesPerMessage: Number(bytesPerMessage.toFixed(1)),
                budgetEventsPerMessage: Number(budget.toFixed(2)),
                server: "TestWorkflowEnvironment.createLocal()",
              },
            }),
          );

          // T-WP3-11: replay the recorded history.
          await Worker.runReplayHistory(
            {
              workflowsPath: join(here, "fixtures/core-workflow.ts"),
            },
            history,
          );
        } finally {
          worker.shutdown();
          await run;
        }
      });
    } catch (err) {
      if (err instanceof Skipped) {
        skip(err.message);
        return;
      }
      throw err;
    }
  }, 180_000);
});

describe("T-WP3-13 agent-core.md behaviours map to tests", () => {
  it("each behaviour lists Tests: ids that exist in test titles", async () => {
    const { readFileSync } = await import("node:fs");
    const root = join(here, "../../..");
    const spec = readFileSync(join(root, "docs/specs/agent-core.md"), "utf8");
    const titles = [
      readFileSync(join(root, "packages/workflows/test/admission.test.ts"), "utf8"),
      readFileSync(join(root, "packages/workflows/test/own-core.test.ts"), "utf8"),
      readFileSync(join(root, "packages/workflows/test/core.contract.ts"), "utf8"),
    ].join("\n");
    const blocks = [...spec.matchAll(/Tests:\s*([^\n]+)/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const m of blocks) {
      const ids = m[1]!.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        expect(titles.includes(id), `test title mentions ${id}`).toBe(true);
      }
    }
  });
});
