import { describe, expect, it } from "vitest";
import { ADMIN_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/admin exports its constant", () => {
  it("exports ADMIN_PACKAGE", () => {
    expect(ADMIN_PACKAGE).toBe("@anyagent/admin");
  });
});
