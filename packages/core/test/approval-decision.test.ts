import { describe, expect, it } from "vitest";
import { decideFromReactions, decideFromStatusEdit } from "../src/approval-decision.js";

describe("T-V1-WP3-02 decision rule", () => {
  const approvers = ["alice", "bob"];
  const agentAccounts = ["bot"];

  it("✅ by approver", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["alice"] },
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "approved", decidedBy: "alice" });
  });

  it("✅ by non-approver → none", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["carol"] },
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });

  it("❌ by approver", () => {
    expect(
      decideFromReactions({
        reactions: { "❌": ["bob"] },
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "denied", decidedBy: "bob" });
  });

  it("both kinds → deny wins", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["alice"], "❌": ["bob"] },
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "denied", decidedBy: "bob" });
  });

  it("reaction removed before check → none", () => {
    expect(
      decideFromReactions({
        reactions: {},
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });

  it("reaction by agent account ignored", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["bot"] },
        approvers: ["bot", "alice"],
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });

  it("approver who left (not in list) ignored", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["gone"] },
        approvers: ["alice"],
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });

  it("empty approvers → none", () => {
    expect(
      decideFromReactions({
        reactions: { "✅": ["alice"] },
        approvers: [],
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });

  it("status edit by approver when modifier visible", () => {
    expect(
      decideFromStatusEdit({
        status: "approved",
        modifiedById: "alice",
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "approved", decidedBy: "alice" });
  });

  it("status edit ignored when modifier missing", () => {
    expect(
      decideFromStatusEdit({
        status: "approved",
        modifiedById: undefined,
        approvers,
        agentAccounts,
      }),
    ).toEqual({ kind: "none" });
  });
});
