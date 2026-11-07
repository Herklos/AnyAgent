import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_PINS_SRC = join(ROOT, "scripts", "check-pins.mjs");

function runCheckPinsIn(dir: string): { status: number; output: string } {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "check-pins.mjs"), readFileSync(CHECK_PINS_SRC));
  try {
    const output = execFileSync(process.execPath, [join(dir, "scripts", "check-pins.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("T-WP0-04 check-pins", () => {
  it("passes on the real tree", () => {
    const out = execFileSync(process.execPath, [CHECK_PINS_SRC], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("ok: 1.24.0 everywhere");
  });

  it("fails when a package asks for @temporalio/worker@^1.25.0", () => {
    const dir = mkdtempSync(join(tmpdir(), "anyagent-pins-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "fixture-bad-range",
          private: true,
          dependencies: { "@temporalio/worker": "^1.25.0" },
        }),
      );
      const result = runCheckPinsIn(dir);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/@temporalio\/worker/);
      expect(result.output).toMatch(/1\.25\.0|expected exact/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when @temporalio/agent-harness is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "anyagent-harness-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "fixture-harness",
          private: true,
          dependencies: { "@temporalio/agent-harness": "1.0.0" },
        }),
      );
      const result = runCheckPinsIn(dir);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/agent-harness/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
