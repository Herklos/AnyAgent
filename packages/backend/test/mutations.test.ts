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
      /exactly the changed|no duplicates|nothing at or before|duplicates/i,
    );
  });

  it("skipLiveDedup makes the race check fail for duplicates", async () => {
    const backend = new MemoryBackend({ skipLiveDedup: true });
    await backend.ensureSchema(SCHEMA);
    const results = await runConformance({ backend, admin: backend });
    const race = results.find((r) => r.name.includes("events (chat, race)"));
    expect(race?.status).toBe("fail");
    expect(race?.detail ?? "").toMatch(/duplicates/i);
  });
});
