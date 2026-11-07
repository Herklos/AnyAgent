import { describe, expect, it } from "vitest";
import { GATEWAY_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/gateway exports its constant", () => {
  it("exports GATEWAY_PACKAGE", () => {
    expect(GATEWAY_PACKAGE).toBe("@anyagent/gateway");
  });
});
