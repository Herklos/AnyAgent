import { describe, expect, it } from "vitest";
import { MemoryBackend, runConformance, SCHEMA } from "../src/index.js";

describe("T-WP1-02 mutation backends are caught for the right reason", () => {
  it("replayAll makes the resume check fail (not a setup error)", async () => {
    const backend = new MemoryBackend({ replayAll: true });
    await backend.ensureSchema(SCHEMA);
    const results = await runConformance({ backend, admin: backend });
    const resume = results.find((r) => r.name.includes("events (chat, resume)"));
    expect(resume?.status).toBe("fail");
    expect(resume?.detail).toMatch(
      /exactly the changed|no duplicates|nothing at or before|duplicates|deepEqual/i,
    );
  });

  it("skipLiveDedup makes the race or resume check fail for duplicates", async () => {
    const backend = new MemoryBackend({ skipLiveDedup: true });
    await backend.ensureSchema(SCHEMA);
    // Seed activity so live events can collide with catch-up cursors
    const results = await runConformance({ backend, admin: backend });
    const failed = results.filter((r) => r.status === "fail");
    // With skipLiveDedup, race or fault-adjacent ordering can fail; require at least one named failure
    // Prefer the race check which asserts once-each delivery.
    const race = results.find((r) => r.name.includes("events (chat, race)"));
    const resume = results.find((r) => r.name.includes("events (chat, resume)"));
    const interesting = [race, resume].filter((r) => r?.status === "fail");
    if (interesting.length === 0) {
      // Fallback: any failure is acceptable only if it mentions duplicates
      expect(failed.some((f) => /duplicate/i.test(f.detail ?? ""))).toBe(true);
    } else {
      expect(interesting[0]?.detail ?? "").toMatch(
        /duplicate|delivered once|once each|deepEqual|exactly/i,
      );
    }
  });
});
