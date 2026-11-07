/** Copied from Herklos/Michel@402865d — import paths adapted for @anyagent/harness. */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AcpSession, descriptorFor, type FakeScript, grokBuild } from "../src/index.js";

const cwd = "/work";

describe("Grok Build descriptor", () => {
  it("starts `grok agent stdio` without update checks, and passes the model with -m before the subcommand", () => {
    expect(grokBuild.spawn({ cwd }).args).toEqual(["--no-auto-update", "agent", "stdio"]);
    expect(grokBuild.spawn({ cwd, model: "grok-4.7" })).toEqual({
      command: "grok",
      args: ["--no-auto-update", "-m", "grok-4.7", "agent", "stdio"],
    });
    expect(descriptorFor("grok")).toBe(grokBuild);
    expect(grokBuild.protocol).toBeUndefined();
  });

  it("signs in with the API key when it is set, else with a cached login, else not at all", () => {
    const methods = [{ id: "cached_token" }, { id: "xai.api_key" }];
    const pick = (init: Parameters<NonNullable<typeof grokBuild.authMethod>>[1], m = methods) =>
      grokBuild.authMethod?.(m, init);
    expect(pick({ cwd, env: { XAI_API_KEY: "xai-test" } })).toBe("xai.api_key");
    expect(pick({ cwd, env: {} })).toBe("cached_token");
    expect(pick({ cwd, env: { XAI_API_KEY: "xai-test" } }, [{ id: "cached_token" }])).toBe(
      "cached_token",
    );
    expect(pick({ cwd, env: {} }, [{ id: "xai.api_key" }])).toBeUndefined();
    expect(pick({ cwd, env: {} }, [])).toBeUndefined();
  });
});

describe("ACP sign-in", () => {
  function setup(script: FakeScript) {
    const dir = mkdtempSync(join(tmpdir(), "michel-grok-"));
    writeFileSync(join(dir, "script.json"), JSON.stringify(script));
    const work = join(dir, "work");
    mkdirSync(work, { recursive: true });
    const state = join(dir, "state");
    const env = { ANYAGENT_FAKE_SCRIPT: join(dir, "script.json"), ANYAGENT_FAKE_STATE_DIR: state };
    const log = () => {
      try {
        return readFileSync(join(state, "effects.log"), "utf8").trim().split("\n");
      } catch {
        return [];
      }
    };
    return { work, env, log };
  }
  const withAuth = { ...descriptorFor("fake"), authMethod: grokBuild.authMethod };

  it("calls authenticate with the method the descriptor picked before opening the session", async () => {
    const s = setup({ turns: [], authMethods: ["cached_token", "xai.api_key"] });
    const { session } = await AcpSession.open(withAuth, {
      cwd: s.work,
      env: { ...s.env, XAI_API_KEY: "xai-test" },
    });
    expect(s.log()).toEqual(["authenticate xai.api_key"]);
    session.kill();
  });

  it("fails with the listed methods when none is usable", async () => {
    const s = setup({ turns: [], authMethods: ["xai.api_key"] });
    await expect(AcpSession.open(withAuth, { cwd: s.work, env: s.env })).rejects.toThrow(
      /xai\.api_key/,
    );
  });

  it("does not authenticate for harnesses that did not ask for it", async () => {
    const s = setup({ turns: [], authMethods: ["cached_token"] });
    await expect(
      AcpSession.open(descriptorFor("fake"), { cwd: s.work, env: s.env }),
    ).rejects.toThrow(/authentication required/);
  });
});
