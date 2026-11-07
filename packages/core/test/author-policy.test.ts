import { describe, expect, it } from "vitest";
import { isAllowedAuthor, lastModifierAcceptable } from "../src/author-policy.js";

describe("T-WP2-03 author policy", () => {
  it("owner default, explicit list, agent account, non-listed", () => {
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: [] },
        authorId: "owner1",
        ownerIds: ["owner1"],
      }),
    ).toBe(true);
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: [] },
        authorId: "other",
        ownerIds: ["owner1"],
      }),
    ).toBe(false);
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: ["a", "b"] },
        authorId: "b",
        ownerIds: ["owner1"],
      }),
    ).toBe(true);
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: ["a"] },
        authorId: "agent",
        ownerIds: ["owner1"],
        agentAccountId: "agent",
      }),
    ).toBe(false);
  });
});

describe("T-WP2-07 lastModifierAcceptable", () => {
  it("table", () => {
    expect(lastModifierAcceptable("owner", ["owner"], [])).toBe(true);
    expect(lastModifierAcceptable("friend", ["owner"], ["friend"])).toBe(true);
    expect(lastModifierAcceptable("stranger", ["owner"], [])).toBe(false);
    expect(lastModifierAcceptable(undefined, ["owner"], [])).toBe(true);
  });
});
