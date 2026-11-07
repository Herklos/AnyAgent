import type { ObjectRecord } from "@anyagent/backend";
import { describe, expect, it } from "vitest";
import { parseAgentSpec } from "../src/agent-spec.js";

const base = (fields: ObjectRecord["fields"]): ObjectRecord => ({
  id: "1",
  type: "aa_agent",
  name: "a",
  fields,
  fieldVersions: {},
  authorId: "o",
  modifiedById: "o",
  createdAt: "",
  modifiedAt: "",
  cursor: "0",
});

describe("T-WP2-02 agent spec", () => {
  it("valid record parses; body becomes instructions; defaults apply", () => {
    const r = parseAgentSpec(
      base({
        aa_handle: "chief",
        aa_harness: "claude-code",
        aa_chat: "chat1",
      }),
      "Do things",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.approvalMode).toBe("read_only");
      expect(r.spec.lifecycle).toBe("live");
      expect(r.spec.instructions).toBe("Do things");
    }
  });

  it("invalid cases name their fields", () => {
    const r = parseAgentSpec(base({ aa_handle: "BAD", aa_harness: "nope" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field);
      expect(fields).toContain("aa_handle");
      expect(fields).toContain("aa_harness");
      expect(fields).toContain("aa_chat");
    }
  });

  it("present but wrongly typed fields error instead of defaulting", () => {
    const r = parseAgentSpec(
      base({
        aa_handle: "chief",
        aa_harness: "claude-code",
        aa_chat: "chat1",
        aa_lifecycle: ["paused"] as unknown as string,
        aa_approval_mode: 1 as unknown as string,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const byField = Object.fromEntries(r.errors.map((e) => [e.field, e.message]));
      expect(byField.aa_lifecycle).toMatch(/expected a string/);
      expect(byField.aa_approval_mode).toMatch(/expected a string/);
    }
  });

  it("blank aa_chat is required (createAgent placeholder before link)", () => {
    const r = parseAgentSpec(
      base({
        aa_handle: "chief",
        aa_harness: "claude-code",
        aa_chat: "",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "aa_chat" && /required/.test(e.message))).toBe(true);
    }
  });
});
