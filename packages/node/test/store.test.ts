import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("node store sessions and ops", () => {
  it("persists sessions and idempotent ops", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-store-"));
    dirs.push(dir);
    const s = new NodeStore(join(dir, "n.sqlite"));
    s.putSession({
      workflowId: "wf1",
      harness: "fake",
      model: "m",
      mode: "read_only",
      sessionId: "sess-1",
    });
    expect(s.getSession("wf1")?.sessionId).toBe("sess-1");
    s.putOp("k1", "msg-1");
    expect(s.getOp("k1")).toBe("msg-1");
    s.putOp("k1", "msg-2");
    expect(s.getOp("k1")).toBe("msg-1");
    s.close();
  });
});
