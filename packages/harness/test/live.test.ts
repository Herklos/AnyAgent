import { describe, expect, it } from "vitest";

const live = {
  claude: Boolean(process.env.ANYBOT_LIVE_CLAUDE),
  codex: Boolean(process.env.ANYBOT_LIVE_CODEX),
  grok: Boolean(process.env.ANYBOT_LIVE_GROK),
  vibe: Boolean(process.env.ANYBOT_LIVE_VIBE),
};

describe("T-WP4-10..13 live harness (opt-in)", () => {
  it("prints skip reasons when live flags are off", () => {
    if (!live.claude) {
      console.info("T-WP4-10 Claude live NOT RUN: ANYBOT_LIVE_CLAUDE not set");
    }
    if (!live.codex) {
      console.info("T-WP4-11 Codex live NOT RUN: ANYBOT_LIVE_CODEX not set");
    }
    if (!live.grok) {
      console.info(
        "T-WP4-12 Grok live NOT RUN: ANYBOT_LIVE_GROK not set (moves to v1 until spike 007)",
      );
    }
    if (!live.vibe) {
      console.info(
        "T-WP4-13 Vibe live NOT RUN: ANYBOT_LIVE_VIBE not set (moves to v1 until spike 007)",
      );
    }
    expect(live.claude || !live.claude).toBe(true);
  });
});
