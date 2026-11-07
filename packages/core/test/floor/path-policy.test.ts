/** Adapted from Herklos/Michel@402865d path-policy tests — AgentSpec parse coverage lives in Michel; here we test pure path helpers. */

import { describe, expect, it } from "vitest";
import {
  fileEditTarget,
  fileScopeAllowed,
  OWN_TASK_WORKTREES,
  withinTaskWorktree,
} from "../../src/floor/index.js";

describe("approvals.allow.paths helpers", () => {
  it("needs the entry, an Edit or Write tool and the node's verdict", () => {
    const on = [OWN_TASK_WORKTREES];
    expect(fileScopeAllowed(on, "Edit", OWN_TASK_WORKTREES)).toBe(true);
    expect(fileScopeAllowed(on, "Write", OWN_TASK_WORKTREES)).toBe(true);
    expect(fileScopeAllowed(on, "Edit", undefined)).toBe(false);
    expect(fileScopeAllowed(on, "Bash", OWN_TASK_WORKTREES)).toBe(false);
    expect(fileScopeAllowed([], "Write", OWN_TASK_WORKTREES)).toBe(false);
  });
});

describe("fileEditTarget", () => {
  it("takes only an absolute string file_path", () => {
    expect(fileEditTarget({ file_path: "/a/b" })).toBe("/a/b");
    expect(fileEditTarget({ file_path: "a/b" })).toBeUndefined();
    expect(fileEditTarget({ file_path: "" })).toBeUndefined();
    expect(fileEditTarget(null)).toBeUndefined();
    expect(fileEditTarget({ file_path: "/a\0b" })).toBeUndefined();
  });
});

describe("withinTaskWorktree", () => {
  it("requires task/project depth under the root", () => {
    expect(withinTaskWorktree("/tasks", "/tasks/t1/p1/file.ts")).toBe(true);
    expect(withinTaskWorktree("/tasks", "/tasks/t1/file.ts")).toBe(false);
    expect(withinTaskWorktree("/tasks", "/tasks/t1/p1/.git/x")).toBe(false);
    expect(withinTaskWorktree("/tasks", "/other/t1/p1/file.ts")).toBe(false);
  });
});
