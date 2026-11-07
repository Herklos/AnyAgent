import { describe, it } from "vitest";

const live = process.env.ANYAGENT_LIVE_ANYTYPE === "1";

describe("T-WP2-08 live admin", () => {
  it.skipIf(!live)("initOrg and createAgent against a real anytype serve", async () => {
    throw new Error("live procedure not configured in this environment");
  });

  it("prints skip reason when live is off", ({ expect }) => {
    if (live) return;
    expect(live).toBe(false);
    console.info("T-WP2-08 skipped: ANYAGENT_LIVE_ANYTYPE not set (NOT RUN: no live anytype serve)");
  });
});
