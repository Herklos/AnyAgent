import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverConfigPath } from "../src/config-discovery.js";

const dirs: string[] = [];
const prev = { ...process.env };

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.env.ANYBOT_CONFIG = prev.ANYBOT_CONFIG;
  if (prev.ANYBOT_CONFIG === undefined) delete process.env.ANYBOT_CONFIG;
});

const minimal = `
version: 1
temporal: { address: "localhost:7233", namespace: "default" }
state: { dir: "/tmp/anybot-state" }
node: { handle: "node1", workdirRoots: ["/tmp"] }
orgs:
  - id: o1
    backend: { kind: anytype, url: "http://127.0.0.1:9", readKeyEnv: K, writeKeyEnv: K }
    space: s1
harnesses: {}
`;

describe("T-WP7-02 config discovery", () => {
  it("prefers --config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    dirs.push(dir);
    const p = join(dir, "c.yaml");
    writeFileSync(p, minimal);
    expect(discoverConfigPath(p)).toBe(p);
  });

  it("uses ANYBOT_CONFIG next", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    dirs.push(dir);
    const p = join(dir, "env.yaml");
    writeFileSync(p, minimal);
    process.env.ANYBOT_CONFIG = p;
    expect(discoverConfigPath()).toBe(p);
  });
});
