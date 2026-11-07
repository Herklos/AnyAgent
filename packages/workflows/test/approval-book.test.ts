import { describe, expect, it } from "vitest";
import { ApprovalBook } from "../src/core/approval-book.js";

describe("T-V1-WP2-01 ApprovalBook", () => {
  it("request once per id; repeated returns same entry", () => {
    const book = new ApprovalBook();
    const a = book.request({
      requestId: "r1",
      toolName: "Edit",
      summary: "edit f",
      risk: "medium",
      expiresInMs: 1000,
    });
    const b = book.request({
      requestId: "r1",
      toolName: "Edit",
      summary: "other",
      risk: "high",
      expiresInMs: 999,
    });
    expect(b).toBe(a);
    expect(a.summary).toBe("edit f");
  });

  it("one decision wins; second is already_decided", () => {
    const book = new ApprovalBook();
    book.request({
      requestId: "r1",
      toolName: "Edit",
      summary: "s",
      risk: "low",
      expiresInMs: 1,
    });
    const d1 = book.decide("r1", { approved: true, decidedBy: "owner" });
    expect(d1.outcome).toBe("decided");
    const d2 = book.decide("r1", { approved: false, decidedBy: "other" });
    expect(d2.outcome).toBe("already_decided");
    expect(book.get("r1")?.status).toBe("approved");
  });

  it("decide after expire is ignored_expired", () => {
    const book = new ApprovalBook();
    book.request({
      requestId: "r1",
      toolName: "Edit",
      summary: "s",
      risk: "low",
      expiresInMs: 1,
    });
    book.expire("r1");
    const d = book.decide("r1", { approved: true, decidedBy: "owner" });
    expect(d.outcome).toBe("ignored_expired");
    expect(book.get("r1")?.status).toBe("expired");
  });

  it("pending list preserves order", () => {
    const book = new ApprovalBook();
    book.request({
      requestId: "a",
      toolName: "t",
      summary: "1",
      risk: "low",
      expiresInMs: 1,
    });
    book.request({
      requestId: "b",
      toolName: "t",
      summary: "2",
      risk: "low",
      expiresInMs: 1,
    });
    expect(book.pending().map((e) => e.requestId)).toEqual(["a", "b"]);
    book.decide("a", { approved: true, decidedBy: "o" });
    expect(book.pending().map((e) => e.requestId)).toEqual(["b"]);
  });

  it("unknown decide returns unknown", () => {
    const book = new ApprovalBook();
    expect(book.decide("nope", { approved: true, decidedBy: "o" }).outcome).toBe("unknown");
  });
});
