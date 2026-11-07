import { runConformance, SCHEMA } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { createAnytypeAdapter } from "../src/index.js";
import { type MockHeart, startMockHeart } from "./mock-heart.js";

/** Capabilities the mock actually exercises (not claimed for live heart). */
const MOCK_CAPABILITIES = [
  "resume-cursor",
  "removal-resume",
  "field-versions",
  "roles",
  "agent-envelope",
] as const;

describe("T-WP1-03 adapter vs mock: full suite", () => {
  let mock: MockHeart | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it("defaults to empty capabilities when none are passed", async () => {
    mock = await startMockHeart();
    const adapter = createAnytypeAdapter({
      url: mock.url,
      apiKey: mock.token,
      spaceId: mock.spaceId,
      verified: false,
    });
    expect([...adapter.capabilities]).toEqual([]);
  });

  it("identity.self uses members/me (participant), not whoami (key)", async () => {
    mock = await startMockHeart();
    const adapter = createAnytypeAdapter({
      url: mock.url,
      apiKey: mock.token,
      spaceId: mock.spaceId,
      capabilities: [...MOCK_CAPABILITIES],
    });
    const self = await adapter.identity.self();
    expect(self.id).toBe(mock.backend.me);
    expect(self.id).not.toBe(mock.keyId);
    const posted = await adapter.chat.post(await adapter.chat.general(), { text: "hi" });
    expect(posted.authorId).toBe(self.id);
  });

  it("ungated checks pass against mock-heart", async () => {
    mock = await startMockHeart();
    const adapter = createAnytypeAdapter({
      url: mock.url,
      apiKey: mock.token,
      spaceId: mock.spaceId,
      verified: false,
      capabilities: [...MOCK_CAPABILITIES],
    });
    expect(adapter.meta.verified).toBe(false);
    await adapter.ensureSchema(SCHEMA);
    const results = await runConformance({ backend: adapter, admin: adapter });
    const failed = results.filter((r) => r.status === "fail");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    for (const r of results) {
      if (r.status === "skip") expect(r.detail).toMatch(/needs /);
      else expect(r.status).toBe("pass");
    }
  });

  it("T-WP1-04 dropped chat stream resumes without duplicates", async () => {
    mock = await startMockHeart();
    mock.dropChatStreamAfter = 1;
    const adapter = createAnytypeAdapter({
      url: mock.url,
      apiKey: mock.token,
      spaceId: mock.spaceId,
      capabilities: [...MOCK_CAPABILITIES],
    });
    await adapter.ensureSchema(SCHEMA);
    const chatId = await adapter.chat.general();
    const ac = new AbortController();
    const seen = new Map<string, number>();
    const collecting = (async () => {
      for await (const ev of adapter.events.watch(
        { kind: "chat", chatId },
        { signal: ac.signal },
      )) {
        if (ev.kind !== "chat" || !ev.message) continue;
        seen.set(ev.message.id, (seen.get(ev.message.id) ?? 0) + 1);
        if (seen.size >= 2) break;
      }
    })();
    await adapter.chat.post(chatId, { text: "one" });
    await adapter.chat.post(chatId, { text: "two" });
    await Promise.race([collecting, new Promise((r) => setTimeout(r, 5_000))]);
    ac.abort();
    expect(seen.size).toBeGreaterThanOrEqual(2);
    for (const [, n] of seen) expect(n).toBe(1);
  });
});
