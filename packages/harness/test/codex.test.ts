/** Copied from Herklos/Michel@402865d — import paths adapted for @anyagent/harness. */

import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexSession, codexApprovalId, codexSandbox } from "../src/codex.js";

const fixture = fileURLToPath(new URL("./support/codex-fixture.mjs", import.meta.url));
const open = (cwd: string, id?: string) =>
  CodexSession.open(
    { cwd, env: { ...process.env, CODEX_FIXTURE_EFFECTS: join(cwd, "effects") } },
    id,
    undefined,
    {
      command: process.execPath,
      args: [fixture],
    },
  );
describe("native Codex protocol adapter", () => {
  it("disables inherited MCP, streams and maps usage; reconnects the same thread", async () => {
    const dir = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    const first = await open(dir);
    const chunks: string[] = [];
    try {
      const result = await first.session.prompt(
        { text: "reply" },
        (e) => {
          if (e.type === "text_delta") chunks.push(e.text);
        },
        async () => ({ outcome: "cancelled" }),
      );
      expect(result).toMatchObject({
        text: "pong",
        usage: { totalTokens: 7, cachedReadTokens: 1 },
      });
      expect(chunks.join("")).toBe(result.text);
    } finally {
      await first.session.close();
    }
    const second = await open(dir, first.session.handle.sessionId);
    expect(second.resumed).toBe("resume");
    expect(second.session.handle.sessionId).toBe(first.session.handle.sessionId);
    await second.session.close();
  });
  it.each(["accept", "decline", "cancel"])(
    "maps %s without granting a session or policy amendment",
    async (optionId) => {
      const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
      const { session } = await open(cwd);
      try {
        await session.prompt(
          { text: "write" },
          () => {},
          async (req) => {
            expect(req.rawInput).toMatchObject({ command: "write effect", cwd: realpathSync(cwd) });
            expect(req.options.map((o) => o.optionId)).toEqual(["accept", "decline"]);
            return optionId === "cancel"
              ? { outcome: "cancelled" }
              : { outcome: "selected", optionId };
          },
        );
        expect(existsSync(join(cwd, "effects"))).toBe(optionId === "accept");
        if (optionId === "accept")
          expect(readFileSync(join(cwd, "effects"), "utf8")).toBe("effect\n");
      } finally {
        await session.close();
      }
    },
  );
  it("reports process loss after execution without acknowledging a successful turn", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    const { session } = await open(cwd);
    try {
      await expect(
        session.prompt(
          { text: "crash-after-effect" },
          () => {},
          async () => ({ outcome: "selected", optionId: "accept" }),
        ),
      ).rejects.toThrow("harness process exited");
      expect(readFileSync(join(cwd, "effects"), "utf8")).toBe("effect\n");
    } finally {
      await session.close();
    }
  });
  it("cancels a pending native turn without an effect", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    const { session } = await open(cwd);
    try {
      const result = await session.prompt(
        { text: "write" },
        () => {},
        async () => {
          session.cancel();
          return { outcome: "cancelled" };
        },
      );
      expect(result.stopReason).toBe("cancelled");
      expect(existsSync(join(cwd, "effects"))).toBe(false);
    } finally {
      await session.close();
    }
  });
  it("refuses an unexpected MCP server before sending any prompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    await expect(
      CodexSession.open(
        { cwd, env: { ...process.env, CODEX_FIXTURE_UNEXPECTED_MCP: "1" } },
        undefined,
        undefined,
        {
          command: process.execPath,
          args: [fixture],
        },
      ),
    ).rejects.toThrow("Unexpected MCP server");
  });
  it("fails the turn when persisting or obtaining an approval fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    const { session } = await open(cwd);
    try {
      await expect(
        session.prompt(
          { text: "write" },
          () => {},
          async () => {
            throw new Error("journal unavailable");
          },
        ),
      ).rejects.toThrow("journal unavailable");
      expect(existsSync(join(cwd, "effects"))).toBe(false);
    } finally {
      await session.close();
    }
  });
  it("refuses a late approval for an earlier native turn without asking the owner", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "michel-codex-peer-"));
    const { session } = await open(cwd);
    let asked = 0;
    try {
      await expect(
        session.prompt(
          { text: "stale-approval" },
          () => {},
          async () => {
            asked++;
            return { outcome: "selected", optionId: "accept" };
          },
        ),
      ).rejects.toThrow("different native turn");
      expect(asked).toBe(0);
      expect(existsSync(join(cwd, "effects"))).toBe(false);
    } finally {
      await session.close();
    }
  });
  it("includes method, thread, turn, item and callback in approval identity", () => {
    const p = { threadId: "thread", turnId: "turn", itemId: "item" };
    for (const change of [
      { turnId: "other" },
      { threadId: "other" },
      { itemId: "other" },
      { approvalId: "other" },
    ]) {
      expect(codexApprovalId("command", { ...p, ...change })).not.toBe(
        codexApprovalId("command", p),
      );
    }
    expect(codexApprovalId("file", p)).not.toBe(codexApprovalId("command", p));
  });
});

describe("Codex sandbox follows the Michel approval mode (docs/specs/approvals-broad.md)", () => {
  it("maps each mode", () => {
    expect(codexSandbox(undefined)).toBe("read-only");
    expect(codexSandbox("read_only")).toBe("read-only");
    expect(codexSandbox("ask")).toBe("read-only");
    expect(codexSandbox("auto")).toBe("workspace-write");
    expect(codexSandbox("full")).toBe("danger-full-access");
  });
  it.each([
    ["auto", "workspace-write"],
    ["full", "danger-full-access"],
    ["ask", "read-only"],
  ] as const)(
    "starts a %s thread with the %s sandbox and still asks Michel",
    async (approvalMode, sandbox) => {
      const dir = mkdtempSync(join(tmpdir(), "michel-codex-sandbox-"));
      const params = join(dir, "params.json");
      const { session } = await CodexSession.open(
        {
          cwd: dir,
          approvalMode,
          writableRoots: ["/projects"],
          env: { ...process.env, CODEX_FIXTURE_SANDBOX: sandbox, CODEX_FIXTURE_PARAMS: params },
        },
        undefined,
        undefined,
        { command: process.execPath, args: [fixture] },
      );
      try {
        const sent = JSON.parse(readFileSync(params, "utf8"));
        expect(sent.sandbox).toBe(sandbox);
        expect(sent.approvalPolicy).toBe("untrusted");
        expect(sent.config["sandbox_workspace_write.writable_roots"]).toEqual(
          approvalMode === "auto" ? ["/projects"] : undefined,
        );
        expect(sent.config["sandbox_workspace_write.network_access"]).toBe(
          approvalMode === "auto" ? false : undefined,
        );
      } finally {
        await session.close();
      }
    },
  );
});
