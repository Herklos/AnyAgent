import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetMemoryBackends } from "../src/backends.js";
import { runCli } from "../src/cli.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.ANYBOT_BACKEND;
  resetMemoryBackends();
});

describe("T-WP7-07 run gate", () => {
  it("refuses to start when Temporal is down (D6)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    dirs.push(dir);
    const cfg = join(dir, "anybot.config.yaml");
    writeFileSync(
      cfg,
      `
version: 1
temporal: { address: "127.0.0.1:1", namespace: "default" }
state: { dir: "${dir}/state" }
node: { handle: "node1", workdirRoots: ["${dir}"] }
orgs:
  - id: personal
    backend: { kind: anytype, url: "http://127.0.0.1:9", readKeyEnv: K, writeKeyEnv: K }
    space: space1
harnesses: {}
`,
    );
    process.env.ANYBOT_BACKEND = "memory";
    await runCli(["node", "anybot", "init", "--config", cfg]);
    const r = await runCli(["node", "anybot", "run", "--config", cfg]);
    expect(r.code).toBe(1);
  }, 30_000);
});
