import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("T-WP7-10 getting-started commands extractable", () => {
  it("documents the four commands", () => {
    const md = readFileSync(join(root, "docs/GETTING-STARTED.md"), "utf8");
    for (const cmd of ["anybot init", "anybot agent create", "anybot run", "anybot doctor"]) {
      expect(md).toContain(cmd);
    }
  });
});
