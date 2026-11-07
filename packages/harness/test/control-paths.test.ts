/** Copied from Herklos/Michel@402865d — import paths adapted; opencode dropped (WP4). */

import { describe, expect, it } from "vitest";
import { descriptorFor } from "../src/registry.js";

describe("harness control paths", () => {
  it("declares what each known harness loads from its working directory", () => {
    expect(descriptorFor("claude-code").controlPaths).toEqual(
      expect.arrayContaining([".claude", ".mcp.json"]),
    );
    expect(descriptorFor("codex").controlPaths).toEqual(expect.arrayContaining([".codex"]));
  });
  it("declares nothing for a harness whose project files are not known", () => {
    expect(descriptorFor("fake").controlPaths ?? []).toEqual([]);
    expect(descriptorFor("custom", { command: "x" }).controlPaths ?? []).toEqual([]);
    expect(descriptorFor("vibe").controlPaths ?? []).toEqual([]);
  });
  it("names only single, relative path segments", () => {
    for (const id of ["claude-code", "codex", "grok", "fake", "vibe"])
      for (const entry of descriptorFor(id).controlPaths ?? []) expect(entry).toMatch(/^[^/\\]+$/);
  });
});
