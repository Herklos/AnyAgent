import { describe, expect, it } from "vitest";
import { AdmissionQueue } from "../src/core/admission.js";
import type { ChatInput } from "../src/core/types.js";

const msg = (key: string, text = "hi"): ChatInput => ({
  key,
  chatId: "c",
  messageId: key,
  authorId: "a",
  text,
});

describe("T-WP3-01 admission order and dispositions", () => {
  it("first opened, rest queued, turn numbers 1..n", () => {
    const q = new AdmissionQueue();
    const a1 = q.admit(msg("k1"));
    expect(a1).toEqual({ disposition: "opened", turnNumber: 1 });
    q.begin(msg("k1"));
    const a2 = q.admit(msg("k2"));
    const a3 = q.admit(msg("k3"));
    expect(a2.disposition).toBe("queued");
    expect(a3.disposition).toBe("queued");
    expect([a1.turnNumber, a2.turnNumber, a3.turnNumber]).toEqual([1, 2, 3]);
  });
});

describe("T-WP3-02 duplicate key", () => {
  it("returns duplicate with original number and does not queue", () => {
    const q = new AdmissionQueue();
    q.admit(msg("k1"));
    const dup = q.admit(msg("k1"));
    expect(dup).toEqual({ disposition: "duplicate", turnNumber: 1 });
    expect(q.snapshot().queued).toBe(1);
  });
});

describe("T-WP3-03 after requestClose", () => {
  it("refuses admission; queued items still returned by next()", () => {
    const q = new AdmissionQueue();
    q.admit(msg("k1"));
    q.admit(msg("k2"));
    q.requestClose();
    expect(() => q.admit(msg("k3"))).toThrow(/AgentClosed/);
    expect(q.next()?.input.key).toBe("k1");
    expect(q.next()?.input.key).toBe("k2");
    expect(q.next()).toBeUndefined();
  });
});

describe("T-WP3-04 snapshot consistency (fixed seed sequence)", () => {
  it("counts stay consistent through a fixed sequence", () => {
    const q = new AdmissionQueue();
    const keys = ["a", "b", "c", "a", "d", "b", "e"];
    for (const k of keys) {
      try {
        q.admit(msg(k));
      } catch {
        /* ignore */
      }
    }
    // unique admitted: a,b,c,d,e = 5
    expect(q.snapshot().accepted).toBe(5);
    expect(q.snapshot().queued).toBe(5);
    const first = q.next();
    q.begin(first!.input);
    q.finish(true);
    expect(q.snapshot().turns).toBe(1);
    expect(q.snapshot().queued).toBe(4);
  });
});

describe("T-WP3-05 rotation hint", () => {
  it("true at threshold, false just below", () => {
    const q = new AdmissionQueue({ rotateAfterAccepted: 3 });
    q.admit(msg("1"));
    q.admit(msg("2"));
    expect(q.rotation().continueAsNewSuggested).toBe(false);
    q.admit(msg("3"));
    expect(q.rotation().continueAsNewSuggested).toBe(true);
  });
});
