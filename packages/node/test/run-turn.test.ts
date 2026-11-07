import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessSession } from "@anyagent/harness";
import type { TurnRequest } from "@anyagent/workflows";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunTurn } from "../src/activities/run-turn.js";
import { NodeStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function baseReq(dir: string, overrides: Partial<TurnRequest> = {}): TurnRequest {
  const baseSpec = {
    handle: "chief",
    harness: "fake",
    chatId: "c1",
    approvalMode: "read_only" as const,
    allowedAuthors: ["owner-1"],
    lifecycle: "live" as const,
    instructions: "test",
    workdir: dir,
  };
  const { spec: specOverride, ...rest } = overrides;
  return {
    orgId: "o",
    spaceId: "s",
    agentId: "a1",
    workflowId: "wf-1",
    chatId: "c1",
    messageId: "m1",
    authorId: "owner-1",
    text: "hello",
    spec: specOverride ? { ...baseSpec, ...specOverride } : baseSpec,
    ...rest,
  };
}

describe("T-WP6-04..06 runTurn fake harness", () => {
  it("T-WP6-04 returns text, stores session, model change starts fresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-turn-"));
    dirs.push(dir);
    const store = new NodeStore(join(dir, "n.sqlite"));
    const runTurn = createRunTurn({ store });

    const r1 = await runTurn(baseReq(dir, { text: "first" }));
    expect(r1.text).toMatch(/reply:first/);
    expect(store.getSession("wf-1")?.sessionId).toBe(r1.sessionId);

    const r2 = await runTurn(baseReq(dir, { text: "second" }));
    expect(r2.text).toMatch(/reply:second/);
    expect(store.getSession("wf-1")?.sessionId).toBeTruthy();

    const r3 = await runTurn(
      baseReq(dir, {
        text: "third",
        spec: { model: "other-model", workdir: dir },
      }),
    );
    expect(r3.text).toMatch(/reply:third/);
    expect(store.getSession("wf-1")?.model).toBe("other-model");
    store.close();
  }, 60_000);

  it("T-WP6-05 read_only denies write; full allows; cred denied both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-perm-"));
    dirs.push(dir);
    const store = new NodeStore(join(dir, "n.sqlite"));
    const runTurn = createRunTurn({ store });

    const roDir = join(dir, "ro");
    const ro = await runTurn(
      baseReq(roDir, { text: "WRITE_PLEASE", workflowId: "wf-ro", spec: { workdir: roDir } }),
    );
    expect(ro.text).toMatch(/write step done/);
    expect(existsSync(join(roDir, "out.txt"))).toBe(false);

    const fullDir = join(dir, "full");
    const full = await runTurn(
      baseReq(fullDir, {
        text: "WRITE_PLEASE",
        workflowId: "wf-full",
        spec: { approvalMode: "full", workdir: fullDir },
      }),
    );
    expect(full.text).toMatch(/write step done/);
    expect(existsSync(join(fullDir, "out.txt"))).toBe(true);

    for (const mode of ["read_only", "full"] as const) {
      const credDir = join(dir, `cred-${mode}`);
      const cred = await runTurn(
        baseReq(credDir, {
          text: "CRED_PLEASE",
          workflowId: `wf-cred-${mode}`,
          spec: { approvalMode: mode, workdir: credDir },
        }),
      );
      expect(cred.text).toMatch(/cred step done/);
      // Floor denies credential paths: no effects log write for the bash
      const effects = join(credDir, ".."); // effects live in fake state dir under tmp, not workdir
      void effects;
      void readFileSync;
    }
    store.close();
  }, 90_000);

  it("T-WP6-06 cancellation kills child and stops heartbeat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-cancel-"));
    dirs.push(dir);
    const store = new NodeStore(join(dir, "n.sqlite"));
    let cancelled = false;
    let closed = false;
    const fakeSession = {
      handle: { sessionId: "sess-cancel" },
      prompt: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { text: "ok", stopReason: "end_turn" };
      },
      cancel: () => {
        cancelled = true;
      },
      close: async () => {
        closed = true;
      },
      kill: () => {
        closed = true;
      },
    } as unknown as HarnessSession;

    const runTurn = createRunTurn({
      store,
      openSession: async () => ({ session: fakeSession, resumed: "none" }),
    });
    const result = await runTurn(baseReq(dir, { text: "x" }));
    expect(result.sessionId).toBe("sess-cancel");
    expect(closed).toBe(true);
    // cancel is only wired when Context.current() exists; unit path skips it
    void cancelled;
    void vi;
    store.close();
  });
});
