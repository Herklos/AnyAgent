import { describe, expect, it } from "vitest";
import { CLI_PACKAGE } from "../src/index.js";

describe("T-WP0-01 anyagent exports its constant", () => {
  it("exports CLI_PACKAGE", () => {
    expect(CLI_PACKAGE).toBe("anyagent");
  });
});
