import { describe, expect, it } from "vitest";
import { BACKEND_ANYTYPE_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/backend-anytype exports its constant", () => {
  it("exports BACKEND_ANYTYPE_PACKAGE", () => {
    expect(BACKEND_ANYTYPE_PACKAGE).toBe("@anyagent/backend-anytype");
  });
});
