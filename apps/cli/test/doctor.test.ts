import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { loadConfig } from "@anyagent/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkD1,
  checkD2,
  checkD6,
  checkD7,
  checkD8,
  checkD11,
  checkD12,
} from "../src/doctor/checks.js";
import { runDoctor } from "../src/doctor/run-doctor.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeCfg(dir: string, extra = "") {
  const path = join(dir, "anybot.config.yaml");
  writeFileSync(
    path,
    `
version: 1
temporal: { address: "127.0.0.1:1", namespace: "default" }
state: { dir: "${dir}/state" }
node: { handle: "node1", workdirRoots: ["${dir}"] }
orgs:
  - id: personal
    backend: { kind: anytype, url: "http://127.0.0.1:9", readKeyEnv: SAME, writeKeyEnv: SAME }
    space: space1
    owners: ["owner-1"]
harnesses: {}
${extra}
`,
  );
  return path;
}

describe("T-WP7-03 / T-WP7-04 doctor checks", () => {
  it("D1 pass and fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-"));
    dirs.push(dir);
    const path = writeCfg(dir);
    const config = loadConfig(path);
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    const deps = {
      config,
      configPath: path,
      backends: new Map([["personal", backend]]),
      orgIds: ["personal"],
    };
    expect((await checkD1(deps)).severity).toBe("pass");
    expect((await checkD1({ ...deps, configPath: join(dir, "missing.yaml") })).severity).toBe(
      "fail",
    );
  });

  it("D2 pass on memory; D6 fail/pass via inject; D11 warn same key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-"));
    dirs.push(dir);
    const path = writeCfg(dir);
    const config = loadConfig(path);
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    const deps = {
      config,
      configPath: path,
      backends: new Map([["personal", backend]]),
      orgIds: ["personal"],
      temporalReachable: async () => ({ ok: false, detail: "down" }),
    };
    expect((await checkD2(deps)).severity).toBe("pass");
    expect((await checkD6(deps)).severity).toBe("fail");
    expect(
      (
        await checkD6({
          ...deps,
          temporalReachable: async () => ({ ok: true, detail: "up" }),
        })
      ).severity,
    ).toBe("pass");
    expect((await checkD11(deps)).severity).toBe("warn");
  });

  it("D7 fail missing harness; D8 pass for fake; D12 fail bad agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-"));
    dirs.push(dir);
    const path = writeCfg(dir);
    const config = loadConfig(path);
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    await createAgent(backend, { handle: "chief", harness: "fake" });
    await backend.objects.create("aa_agent", {
      name: "bad",
      fields: { aa_handle: "BAD", aa_harness: "nope", aa_chat: "x", aa_approval_mode: "read_only" },
    });
    const deps = {
      config,
      configPath: path,
      backends: new Map([["personal", backend]]),
      orgIds: ["personal"],
      agentHarnesses: async () => [
        { orgId: "personal", handle: "chief", harness: "claude-code", mode: "read_only" },
      ],
      harnessVersion: async () => ({ ok: false, detail: "not installed" }),
    };
    expect((await checkD7(deps)).severity).toBe("fail");
    expect(
      (await checkD7({ ...deps, harnessVersion: async () => ({ ok: true, detail: "1" }) }))
        .severity,
    ).toBe("pass");
    expect(
      (
        await checkD8({
          ...deps,
          agentHarnesses: async () => [
            { orgId: "personal", handle: "c", harness: "fake", mode: "read_only" },
          ],
        })
      ).severity,
    ).toBe("pass");
    expect((await checkD12(deps)).severity).toBe("fail");
  });

  it("doctor --json shape and exit codes via runDoctor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-"));
    dirs.push(dir);
    const path = writeCfg(dir);
    const config = loadConfig(path);
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    const report = await runDoctor({
      config,
      configPath: path,
      backends: new Map([["personal", backend]]),
      orgIds: ["personal"],
      temporalReachable: async () => ({ ok: true, detail: "up" }),
      harnessVersion: async () => ({ ok: true, detail: "ok" }),
    });
    expect(report.checks.map((c) => c.id)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
      "D8",
      "D9",
      "D10",
      "D11",
      "D12",
      "D13",
      "D14",
      "D15",
      "D16",
    ]);
    expect(typeof report.ok).toBe("boolean");
    JSON.stringify(report);
  });
});
