import { describe, expect, it } from "vitest";
import { isAllowedAuthor, lastModifierAcceptable } from "../src/author-policy.js";

describe("T-WP2-03 author policy", () => {
  it("owner default, explicit list, agent account, non-listed", () => {
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: [] },
        authorId: "owner1",
        ownerIds: ["owner1"],
        agentAccountId: "agent",
      }),
    ).toBe(true);
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: [] },
        authorId: "other",
        ownerIds: ["owner1"],
        agentAccountId: "agent",
      }),
    ).toBe(false);
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: ["a", "b"] },
        authorId: "b",
        ownerIds: ["owner1"],
        agentAccountId: "agent",
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

  it("agent account listed in allowedAuthors is still refused", () => {
    expect(
      isAllowedAuthor({
        spec: { allowedAuthors: ["agent", "friend"] },
        authorId: "agent",
        ownerIds: ["owner1"],
        agentAccountId: "agent",
      }),
    ).toBe(false);
  });
});

describe("T-WP2-07 lastModifierAcceptable", () => {
  it("table for capable and incapable backends", () => {
    expect(
      lastModifierAcceptable({
        capable: true,
        modifiedById: "owner",
        ownerIds: ["owner"],
        allowedAuthors: [],
      }).result,
    ).toBe("ok");
    expect(
      lastModifierAcceptable({
        capable: true,
        modifiedById: "friend",
        ownerIds: ["owner"],
        allowedAuthors: ["friend"],
      }).result,
    ).toBe("ok");
    expect(
      lastModifierAcceptable({
        capable: true,
        modifiedById: "stranger",
        ownerIds: ["owner"],
        allowedAuthors: [],
      }).result,
    ).toBe("forbidden-modifier");
    expect(
      lastModifierAcceptable({
        capable: true,
        modifiedById: undefined,
        ownerIds: ["owner"],
        allowedAuthors: [],
      }).result,
    ).toBe("unknown-modifier-refused");
    expect(
      lastModifierAcceptable({
        capable: false,
        modifiedById: undefined,
        ownerIds: ["owner"],
        allowedAuthors: [],
      }).result,
    ).toBe("not-checked");
  });
});
