import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/core exports its constant", () => {
  it("exports CORE_PACKAGE", () => {
    expect(CORE_PACKAGE).toBe("@anyagent/core");
  });
});
