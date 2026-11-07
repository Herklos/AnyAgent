import { describe, expect, it } from "vitest";
import { decidePermission } from "../src/permission.js";

describe("T-WP4-02 decidePermission", () => {
  it.each([
    {
      mode: "read_only" as const,
      req: { toolName: "Read", kind: "read" as const },
      allow: true,
    },
    {
      mode: "read_only" as const,
      req: { toolName: "WebFetch", kind: "fetch" as const },
      allow: false,
      reason: /read-only/,
    },
    {
      mode: "full" as const,
      req: { toolName: "WebFetch", kind: "fetch" as const },
      allow: true,
    },
    {
      mode: "read_only" as const,
      req: { toolName: "Bash", kind: "execute" as const, rawInput: { command: "echo hi" } },
      allow: false,
      reason: /read-only/,
    },
    {
      mode: "full" as const,
      req: {
        toolName: "Bash",
        kind: "execute" as const,
        rawInput: { command: "cat ~/.ssh/id_rsa" },
        home: "/home/u",
      },
      allow: false,
      reason: /credential|ssh|\.ssh/i,
    },
    {
      mode: "full" as const,
      req: { toolName: "Bash", kind: "execute" as const, rawInput: { command: "echo hi" } },
      allow: true,
    },
    {
      mode: "ask" as const,
      req: { toolName: "Read", kind: "read" as const },
      allow: true,
    },
    {
      mode: "ask" as const,
      req: { toolName: "Edit", kind: "edit" as const },
      allow: false,
      needsApproval: true,
    },
    {
      mode: "ask" as const,
      req: { toolName: "WebFetch", kind: "fetch" as const },
      allow: false,
      needsApproval: true,
    },
    {
      mode: "ask" as const,
      req: {
        toolName: "Bash",
        kind: "execute" as const,
        rawInput: { command: "cat ~/.ssh/id_rsa" },
        home: "/home/u",
      },
      allow: false,
      reason: /credential|ssh|\.ssh/i,
      needsApproval: false,
    },
  ])("$mode $req.toolName → allow=$allow", ({ mode, req, allow, reason, needsApproval }) => {
    const r = decidePermission(mode, req);
    expect(r.allow).toBe(allow);
    if (reason) expect(r.reason).toMatch(reason);
    if (needsApproval !== undefined) {
      expect(Boolean(r.needsApproval)).toBe(needsApproval);
    }
  });
});
