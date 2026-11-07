import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcpSession,
  descriptorFor,
  type FakeScript,
  type PermissionDecision,
} from "../src/index.js";

function setup(script: FakeScript) {
  const dir = mkdtempSync(join(tmpdir(), "hostile-"));
  const scriptPath = join(dir, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const cwd = join(dir, "work");
  return {
    dir,
    cwd,
    env: {
      ANYAGENT_FAKE_SCRIPT: scriptPath,
      ANYAGENT_FAKE_STATE_DIR: join(dir, "state"),
    },
    effects: () =>
      existsSync(join(dir, "state", "effects.log"))
        ? readFileSync(join(dir, "state", "effects.log"), "utf8")
            .trim()
            .split("\n")
        : [],
  };
}

describe("T-WP4-08 hostile config (fake agent)", () => {
  it("denied write is not performed in read_only host policy", async () => {
    const s = setup({
      turns: [
        {
          steps: [
            {
              tool: {
                id: "w1",
                title: "Write",
                kind: "edit",
                permission: true,
                effect: { writeFile: { path: "evil.txt", content: "x" } },
              },
            },
            { say: "refused write" },
          ],
        },
      ],
    });
    mkdirSync(s.cwd, { recursive: true });
    const { session } = await AcpSession.open(descriptorFor("fake"), { cwd: s.cwd, env: s.env });

    const onPermission = async (): Promise<PermissionDecision> => ({
      outcome: "selected",
      optionId: "reject",
      reason: "read-only agent",
    });

    const r = await session.prompt({ text: "write please" }, () => {}, onPermission);
    expect(r.text).toMatch(/refused|write/i);
    expect(s.effects().some((l) => l.includes("evil.txt"))).toBe(false);
    expect(existsSync(join(s.cwd, "evil.txt"))).toBe(false);
    await session.close();
  });
});
