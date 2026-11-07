import { describe, expect, it } from "vitest";
import { WORKFLOWS_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/workflows exports its constant", () => {
  it("exports WORKFLOWS_PACKAGE", () => {
    expect(WORKFLOWS_PACKAGE).toBe("@anyagent/workflows");
  });
});
