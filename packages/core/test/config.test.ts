import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

function writeCfg(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aa-cfg-"));
  const path = join(dir, "anyagent.config.yaml");
  writeFileSync(path, body);
  return path;
}

describe("T-WP2-01 config loader", () => {
  it("valid file loads", () => {
    const path = writeCfg(`
version: 1
temporal: { address: "localhost:7233", namespace: "default" }
state: { dir: "/tmp/aa" }
node: { handle: "lap", workdirRoots: ["/tmp"] }
orgs:
  - id: personal
    backend: { kind: anytype, url: "http://127.0.0.1:31012", readKeyEnv: K, writeKeyEnv: K }
    space: "s1"
harnesses: {}
`);
    try {
      const cfg = loadConfig(path);
      expect(cfg.orgs).toHaveLength(1);
      expect(cfg.node.handle).toBe("lap");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("reports duplicate org ids, unknown kind, unknown key, bad handle together", () => {
    const path = writeCfg(`
version: 1
temporal: { address: "x", namespace: "y" }
state: { dir: "/tmp" }
node: { handle: "BAD", workdirRoots: ["~"] }
extra: true
orgs:
  - id: a
    backend: { kind: anytype, url: "u", readKeyEnv: K, writeKeyEnv: K }
    space: "s"
  - id: a
    backend: { kind: other, url: "u", readKeyEnv: K, writeKeyEnv: K }
    space: "s"
`);
    try {
      expect(() => loadConfig(path)).toThrow(/config invalid/);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
