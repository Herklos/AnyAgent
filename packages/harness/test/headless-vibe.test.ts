import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  HarnessError,
  type HeadlessCliDescriptor,
  HeadlessCliSession,
  parseVibeOutput,
} from "../src/index.js";

const fakeVibe = fileURLToPath(new URL("./support/fake-vibe.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function desc(overrides: Partial<HeadlessCliDescriptor> = {}): HeadlessCliDescriptor {
  return {
    id: "vibe",
    label: "fake vibe",
    permissionCallbacks: false,
    command: process.execPath,
    output: "json",
    buildArgs: ({ prompt, mode, resumeSessionId, output }) => {
      const args = [fakeVibe, "-p", prompt, "--output", output];
      if (mode === "read_only") args.push("--agent", "ask");
      else args.push("--agent", "auto-approve", "--auto-approve");
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      return args;
    },
    parseOutput: parseVibeOutput,
    mapExitCode: (code) => {
      if (code === 0) return "ok";
      if (code === 3) return "limit";
      return "harness_error";
    },
    ...overrides,
  };
}

describe("T-WP4-13a headless vibe fixtures", () => {
  it("parses JSON and streaming; resume flag on second turn", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vibe-"));
    dirs.push(cwd);
    const log = join(cwd, "args.log");
    const session = new HeadlessCliSession(
      desc(),
      {
        cwd,
        env: { FAKE_VIBE_LOG: log, FAKE_VIBE_MODE: "ok" },
      },
      "read_only",
    );

    const r1 = await session.prompt(
      { text: "hi" },
      () => {},
      async () => ({ outcome: "cancelled" }),
    );
    expect(r1.text).toBe("pong");
    expect(session.handle.sessionId).toBe("sess-json-1");

    const r2 = await session.prompt(
      { text: "again" },
      () => {},
      async () => ({ outcome: "cancelled" }),
    );
    expect(r2.text).toBe("pong");
    const logged = readFileSync(log, "utf8");
    expect(logged).toMatch(/--resume sess-json-1/);
    await session.close();
  });

  it("maps exit codes and fails loudly on bad JSON", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vibe-ex-"));
    dirs.push(cwd);

    for (const [mode, expectLimit] of [
      ["exit1", false],
      ["exit2", false],
      ["exit3", true],
    ] as const) {
      const s = new HeadlessCliSession(desc(), { cwd, env: { FAKE_VIBE_MODE: mode } }, "read_only");
      if (expectLimit) {
        const r = await s.prompt(
          { text: "x" },
          () => {},
          async () => ({ outcome: "cancelled" }),
        );
        expect(r.stopReason).toBe("max_turn_requests");
      } else {
        await expect(
          s.prompt(
            { text: "x" },
            () => {},
            async () => ({ outcome: "cancelled" }),
          ),
        ).rejects.toBeInstanceOf(HarnessError);
      }
      await s.close();
    }

    const bad = new HeadlessCliSession(
      desc(),
      { cwd, env: { FAKE_VIBE_MODE: "badjson" } },
      "read_only",
    );
    await expect(
      bad.prompt(
        { text: "x" },
        () => {},
        async () => ({ outcome: "cancelled" }),
      ),
    ).rejects.toThrow(/cannot parse/);
    await bad.close();
  });

  it("cancel sends SIGTERM then SIGKILL; no orphan", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vibe-cancel-"));
    dirs.push(cwd);
    const pidFile = join(cwd, "pid");
    const s = new HeadlessCliSession(
      desc({ timeoutMs: 60_000 }),
      {
        cwd,
        env: { FAKE_VIBE_MODE: "sleep", FAKE_VIBE_PID_FILE: pidFile, FAKE_VIBE_SLEEP_MS: "30000" },
      },
      "read_only",
    );

    const turn = s.prompt(
      { text: "x" },
      () => {},
      async () => ({ outcome: "cancelled" }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    s.cancel();
    await expect(turn).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 2500));
    expect(() => process.kill(pid, 0)).toThrow();
    await s.close();
  }, 15_000);
});
