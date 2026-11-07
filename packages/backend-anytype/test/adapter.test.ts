import { runConformance, SCHEMA } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { createAnytypeAdapter } from "../src/index.js";
import { type MockHeart, startMockHeart } from "./mock-heart.js";

describe("T-WP1-03 adapter vs mock: full suite", () => {
  let mock: MockHeart | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it("ungated checks pass against mock-heart", async () => {
    mock = await startMockHeart();
    const adapter = createAnytypeAdapter({
      url: mock.url,
      apiKey: mock.token,
      spaceId: mock.spaceId,
      verified: false,
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
});
