import { describe, expect, it } from "vitest";
import { noticeForFailure } from "../src/contracts.js";

describe("T-WP6 failure notices", () => {
  it.each([
    ["interrupted", /interrupted before it finished/],
    ["harness-unavailable", /not installed or not signed in/],
    ["harness-error", /harness reported an error/],
    ["empty-reply", /without writing a reply/],
    ["invalid-config", /cannot run right now/],
  ] as const)("%s", (kind, re) => {
    expect(
      noticeForFailure(kind, {
        harness: "claude-code",
        message: "boom\nmore",
        configDetail: "bad handle",
      }),
    ).toMatch(re);
  });
});
