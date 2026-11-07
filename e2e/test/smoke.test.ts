import { describe, expect, it } from "vitest";
import { E2E_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/e2e exports its constant", () => {
  it("exports E2E_PACKAGE", () => {
    expect(E2E_PACKAGE).toBe("@anyagent/e2e");
  });
});
