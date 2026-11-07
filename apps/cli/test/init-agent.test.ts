import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetMemoryBackends } from "../src/backends.js";
import { runCli } from "../src/cli.js";
import { noticeAlreadyShown } from "../src/notice.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.ANYBOT_BACKEND;
  resetMemoryBackends();
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cli-"));
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
    owners: ["owner-1"]
harnesses: {}
`,
  );
  process.env.ANYBOT_BACKEND = "memory";
  return { dir, cfg };
}

describe("T-WP7-05 / T-WP7-06 init and agent", () => {
  it("init twice: second nothing to do; notice once", async () => {
    const { dir, cfg } = setup();
    const a = await runCli(["node", "anybot", "init", "--config", cfg]);
    expect(a.code).toBe(0);
    expect(noticeAlreadyShown(join(dir, "state"), "personal")).toBe(true);
    const b = await runCli(["node", "anybot", "init", "--config", cfg]);
    expect(b.code).toBe(0);
  });

  it("agent create then list; duplicate fails", async () => {
    const { cfg } = setup();
    await runCli(["node", "anybot", "init", "--config", cfg]);
    const c1 = await runCli([
      "node",
      "anybot",
      "agent",
      "create",
      "chief",
      "--harness",
      "fake",
      "--config",
      cfg,
    ]);
    expect(c1.code).toBe(0);
    const list = await runCli(["node", "anybot", "agent", "list", "--config", cfg]);
    expect(list.code).toBe(0);
    const dup = await runCli([
      "node",
      "anybot",
      "agent",
      "create",
      "chief",
      "--harness",
      "fake",
      "--config",
      cfg,
    ]);
    expect(dup.code).toBe(1);
  });
});
