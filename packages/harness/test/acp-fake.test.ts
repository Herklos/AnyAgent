/** Copied from Herklos/Michel@402865d — import paths adapted for @anyagent/harness. */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcpSession,
  type AdapterEvent,
  ChildExited,
  descriptorFor,
  type FakeScript,
  type PermissionDecision,
  type PermissionRequest,
} from "../src/index.js";

function setup(script: FakeScript) {
  const dir = mkdtempSync(join(tmpdir(), "anyagent-fake-"));
  const scriptPath = join(dir, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const cwd = join(dir, "work");
  const env = { ANYAGENT_FAKE_SCRIPT: scriptPath, ANYAGENT_FAKE_STATE_DIR: join(dir, "state") };
  return {
    dir,
    cwd,
    env,
    effects: () =>
      existsSync(join(dir, "state", "effects.log"))
        ? readFileSync(join(dir, "state", "effects.log"), "utf8")
            .trim()
            .split("\n")
        : [],
  };
}

async function open(s: ReturnType<typeof setup>, resume?: string) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(s.cwd, { recursive: true });
  return AcpSession.open(descriptorFor("fake"), { cwd: s.cwd, env: s.env }, resume);
}

const allow = async (): Promise<PermissionDecision> => ({ outcome: "selected", optionId: "allow" });
const reject = async (): Promise<PermissionDecision> => ({
  outcome: "selected",
  optionId: "reject",
});

describe("AcpSession against the fake agent", () => {
  it("streams text and reports usage", async () => {
    const s = setup({
      turns: [
        {
          steps: [
            { say: "hello there friend" },
            { usage: { input: 10, output: 5, costUsd: 0.01 } },
          ],
        },
      ],
    });
    const { session } = await open(s);
    const events: AdapterEvent[] = [];
    const r = await session.prompt({ text: "hi" }, (e) => events.push(e), allow);
    expect(r.stopReason).toBe("end_turn");
    expect(r.text).toBe("hello there friend");
    expect(events.filter((e) => e.type === "text_delta").length).toBeGreaterThan(1);
    expect(r.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: 0.01,
    });
    await session.close();
  });

  it("asks permission, applies the effect when allowed and not when rejected", async () => {
    const tool = (id: string) => ({
      tool: {
        id,
        title: `write ${id}`,
        kind: "edit",
        permission: true,
        effect: { writeFile: { path: `${id}.txt`, content: id } },
      },
    });
    const s = setup({
      turns: [
        { match: "A", steps: [tool("a")] },
        { match: "B", steps: [tool("b")] },
      ],
    });
    const { session } = await open(s);
    const asked: PermissionRequest[] = [];
    await session.prompt(
      { text: "A" },
      () => {},
      async (req) => (asked.push(req), allow()),
    );
    await session.prompt(
      { text: "B" },
      () => {},
      async (req) => (asked.push(req), reject()),
    );
    expect(asked.map((a) => a.requestId.split(":")[1])).toEqual(["a", "b"]);
    expect(asked[0]?.options.map((o) => o.kind)).toContain("allow_once");
    expect(existsSync(join(s.cwd, "a.txt"))).toBe(true);
    expect(existsSync(join(s.cwd, "b.txt"))).toBe(false);
    await session.close();
  });

  it("resumes the same session after the process is closed", async () => {
    const s = setup({ turns: [{ steps: [{ say: "ok" }] }] });
    const first = await open(s);
    await first.session.prompt({ text: "one" }, () => {}, allow);
    await first.session.close();
    const second = await open(s, first.session.handle.sessionId);
    expect(second.resumed).toBe("resume");
    expect(second.session.handle.sessionId).toBe(first.session.handle.sessionId);
    const r = await second.session.prompt({ text: "two" }, () => {}, allow);
    expect(r.text).toBe("ok");
    await second.session.close();
  });

  it("falls back to session/load when the harness has no resume, and to a new session for an unknown id", async () => {
    const s = setup({
      capabilities: { resume: false, loadSession: true },
      turns: [{ steps: [{ say: "ok" }] }],
    });
    const first = await open(s);
    await first.session.close();
    const loaded = await open(s, first.session.handle.sessionId);
    expect(loaded.resumed).toBe("load");
    await loaded.session.close();
    const fresh = await open(s, "does-not-exist");
    expect(fresh.resumed).toBe("none");
    expect(fresh.session.handle.sessionId).not.toBe("does-not-exist");
    await fresh.session.close();
  });

  it("reports a hard crash mid-turn, and the session can be resumed afterwards", async () => {
    const s = setup({
      turns: [
        {
          steps: [
            { tool: { id: "t1", title: "first", permission: false, effect: { log: "effect-1" } } },
            { crash: { marker: "PLACEHOLDER" } },
            { tool: { id: "t2", title: "second", permission: false, effect: { log: "effect-2" } } },
          ],
        },
      ],
    });
    // The marker makes the crash fire only on the first run.
    const script = JSON.parse(readFileSync(join(s.dir, "script.json"), "utf8")) as FakeScript;
    (script.turns[0]!.steps[1] as { crash: { marker: string } }).crash.marker = join(
      s.dir,
      "crash.marker",
    );
    writeFileSync(join(s.dir, "script.json"), JSON.stringify(script));

    const first = await open(s);
    await expect(first.session.prompt({ text: "go" }, () => {}, allow)).rejects.toBeInstanceOf(
      ChildExited,
    );
    expect(s.effects()).toEqual(["effect-1"]);

    const again = await open(s, first.session.handle.sessionId);
    expect(again.resumed).toBe("resume");
    // Re-prompting replays the script from the top in the fake; a real harness resumes its own
    // transcript. What matters here is that the session survived the crash.
    const r = await again.session.prompt({ text: "go" }, () => {}, allow);
    expect(r.stopReason).toBe("end_turn");
    await again.session.close();
  });

  it("cancels a turn", async () => {
    const s = setup({ turns: [{ steps: [{ sleep: 300 }, { say: "never" }] }] });
    const { session } = await open(s);
    const p = session.prompt({ text: "go" }, () => {}, allow);
    setTimeout(() => session.cancel(), 50);
    const r = await p;
    expect(r.stopReason).toBe("cancelled");
    await session.close();
  });
});
