import { describe, expect, it } from "vitest";
import { HARNESS_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/harness exports its constant", () => {
  it("exports HARNESS_PACKAGE", () => {
    expect(HARNESS_PACKAGE).toBe("@anyagent/harness");
  });
});
