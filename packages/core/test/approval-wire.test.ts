import { describe, expect, it } from "vitest";
import {
  decodeApprovalMessageRef,
  encodeApprovalMessageRef,
  formatApprovalChatNotice,
  formatDecisionNotice,
  riskForKind,
  summariseAction,
} from "../src/approval-wire.js";

describe("T-V1-WP3-04 summary and risk", () => {
  it("maps kinds to risk", () => {
    expect(riskForKind("execute")).toBe("high");
    expect(riskForKind("delete")).toBe("high");
    expect(riskForKind("edit")).toBe("medium");
    expect(riskForKind("move")).toBe("medium");
    expect(riskForKind("read")).toBe("low");
    expect(riskForKind("fetch")).toBe("low");
    expect(riskForKind(undefined)).toBe("low");
  });

  it("truncates long commands and never includes file contents", () => {
    const long = "x".repeat(400);
    const s = summariseAction({
      toolName: "Bash",
      kind: "execute",
      rawInput: { command: long },
    });
    expect(s.startsWith("run `")).toBe(true);
    expect(s.length).toBeLessThan(320);
    expect(s.endsWith("…`")).toBe(true);

    const edit = summariseAction({
      toolName: "Write",
      kind: "edit",
      rawInput: { path: "/tmp/a.txt", content: "SECRET_CONTENTS" },
    });
    expect(edit).toBe("edit /tmp/a.txt");
    expect(edit).not.toMatch(/SECRET/);
  });

  it("formats chat notices and message refs", () => {
    const notice = formatApprovalChatNotice({
      handle: "chief",
      summary: "edit /tmp/a",
      risk: "medium",
      expiresAtIso: "2026-11-07T16:00:00.000Z",
      objectId: "obj1",
    });
    expect(notice).toMatch(/Approval needed/);
    expect(notice).toMatch(/@chief/);
    expect(notice).toMatch(/Object: obj1/);
    expect(formatDecisionNotice("approved", "alice")).toMatch(/approved by alice/);
    expect(formatDecisionNotice("denied", "bob")).toMatch(/denied by bob/);
    expect(formatDecisionNotice("expired", "system")).toMatch(/expired/);
    expect(encodeApprovalMessageRef("c1", "m1")).toBe("c1/m1");
    expect(decodeApprovalMessageRef("c1/m1")).toEqual({ chatId: "c1", messageId: "m1" });
    expect(decodeApprovalMessageRef("bad")).toBeUndefined();
  });
});
