import { describe, expect, it } from "vitest";
import { runCoreContract } from "./core.contract.js";
import { Skipped, withTemporal } from "./support/temporal.js";

function skipOrFail(err: unknown): void {
  if (err instanceof Skipped) {
    console.info(`Temporal tests skipped: ${err.message}`);
    return;
  }
  throw err;
}

describe("T-WP3 AgentCore Temporal contract", () => {
  it("T-WP3-06..10 contract suite on own core (or skipped)", async () => {
    try {
      await withTemporal(async (env) => {
        await runCoreContract(
          { env },
          {
            equal: (a, b, msg) => expect(a, msg).toEqual(b),
            ok: (v, msg) => expect(v, msg).toBeTruthy(),
          },
        );
      });
    } catch (err) {
      skipOrFail(err);
    }
  }, 120_000);
});

describe("T-WP3-13 agent-core.md behaviours map to tests", () => {
  it("each behaviour number is referenced by a test title or contract", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const spec = readFileSync(join(root, "docs/specs/agent-core.md"), "utf8");
    const titles = [
      readFileSync(join(root, "packages/workflows/test/admission.test.ts"), "utf8"),
      readFileSync(join(root, "packages/workflows/test/own-core.test.ts"), "utf8"),
      readFileSync(join(root, "packages/workflows/test/core.contract.ts"), "utf8"),
    ].join("\n");
    for (let n = 1; n <= 7; n++) {
      expect(
        spec.includes(`${n}.`) || spec.includes(`Behaviour ${n}`),
        `spec has behaviour ${n}`,
      ).toBe(true);
      expect(
        titles.includes(`T-WP3-0${n}`) ||
          titles.includes(`T-WP3-${n}`) ||
          titles.includes(`behaviour ${n}`),
        `tests reference behaviour ${n}`,
      ).toBe(true);
    }
  });
});
