import { describe, expect, it } from "vitest";
import { NODE_PACKAGE } from "../src/index.js";

describe("T-WP0-01 @anyagent/node exports its constant", () => {
  it("exports NODE_PACKAGE", () => {
    expect(NODE_PACKAGE).toBe("@anyagent/node");
  });
});
