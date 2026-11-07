import { describe, it } from "vitest";

const live = process.env.ANYAGENT_LIVE_ANYTYPE === "1";

describe("T-WP1-07 live adapter suite", () => {
  it.skipIf(!live)("adapter passes the suite on a real anytype serve", async () => {
    // Opt-in: set ANYAGENT_LIVE_ANYTYPE=1 with a throwaway space and keys.
    // Spike 002 documents the live procedure; this environment did not run it.
    throw new Error("live procedure not configured in this environment");
  });

  it("prints skip reason when live is off", ({ expect }) => {
    if (live) return;
    expect(live).toBe(false);
    console.info(
      "T-WP1-07 skipped: ANYAGENT_LIVE_ANYTYPE not set (NOT RUN: no live anytype serve)",
    );
  });
});
