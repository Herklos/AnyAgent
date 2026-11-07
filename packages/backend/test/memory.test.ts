import { describe, expect, it } from "vitest";
import { CHECKS, MemoryBackend, runConformance, SCHEMA } from "../src/index.js";

describe("T-WP1-01 reference backend passes the full suite", () => {
  it("all ungated checks pass (and killStreams-gated ones skip)", async () => {
    const backend = new MemoryBackend();
    await backend.ensureSchema(SCHEMA);
    const results = await runConformance({ backend, admin: backend });
    const failed = results.filter((r) => r.status === "fail");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    const passed = results.filter((r) => r.status === "pass");
    expect(passed.length).toBeGreaterThanOrEqual(CHECKS.filter((c) => !c.needsHook).length - 2);
    // Every check without needsHook that capabilities allow must pass
    for (const r of results) {
      if (r.status === "skip") {
        expect(r.detail).toMatch(/needs /);
      } else {
        expect(r.status).toBe("pass");
      }
    }
  });
});

describe("T-WP1-06 org.get body and chat.create", () => {
  it("org.get returns body; chat.create returns a usable id", async () => {
    const backend = new MemoryBackend();
    await backend.ensureSchema(SCHEMA);
    const o = await backend.objects.create("aa_agent", {
      name: "a",
      fields: { aa_handle: "a", aa_harness: "claude-code", aa_approval_mode: "read_only" },
      body: "You answer questions about this machine.",
    });
    const got = await backend.org.get(o.id);
    expect(got?.body).toBe("You answer questions about this machine.");
    const listed = await backend.org.list("aa_agent");
    expect(listed.find((r) => r.id === o.id)?.body).toBeUndefined();
    const chatId = await backend.chat.create({ name: "agent-chat" });
    const m = await backend.chat.post(chatId, { text: "hi" });
    expect(m.chatId).toBe(chatId);
  });
});
