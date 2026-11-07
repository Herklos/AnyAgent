import { describe, expect, it } from "vitest";
import { BACKEND_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/backend exports its constant", () => {
  it("exports BACKEND_PACKAGE", () => {
    expect(BACKEND_PACKAGE).toBe("@anyagent/backend");
  });
});
