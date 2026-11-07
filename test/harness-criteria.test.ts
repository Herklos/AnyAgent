import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "harness-criteria.mjs");

function run(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
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

describe("T-V1-WP1 harness-criteria", () => {
  it("T-V1-WP1-01 deep-import fixture fails criterion 1", () => {
    const r = run(["--fixture", "test/fixtures/harness-criteria/deep-import"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/1:sdk-range-no-deep-import\tFAIL/);
    expect(r.output).toMatch(/recommendation: own gate/);
  });

  it("T-V1-WP1-01 permission-ok fixture passes criterion 2", () => {
    const r = run(["--fixture", "test/fixtures/harness-criteria/permission-ok"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/2:public-permission-api\tPASS/);
  });

  it("T-V1-WP1-01 continue-as-new fixture passes criterion 3", () => {
    const r = run(["--fixture", "test/fixtures/harness-criteria/continue-as-new"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/3:continue-as-new\tPASS/);
  });

  it("T-V1-WP1-01 harness-pass shows all criteria", () => {
    const r = run(["--fixture", "test/fixtures/harness-criteria/harness-pass"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/1:sdk-range-no-deep-import\tPASS/);
    expect(r.output).toMatch(/6:core-contract-passes\tPASS/);
    expect(r.output).toMatch(/continue evaluation/);
  });

  it("T-V1-WP1-02 refuses a target inside the repository", () => {
    const r = run(["--assert-outside-repo", ROOT]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/refusing to use target inside repository/);
  });

  it("T-V1-WP1-04 CARRYOVER covers REPORT limitations", () => {
    const r = run(["--check-carryover"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/ok: CARRYOVER/);
  });
});
