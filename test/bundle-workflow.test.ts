import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("T-WP0-03 bundleWorkflowCode succeeds on the workflows package", () => {
  it("bundles packages/workflows/src/workflows.ts", async () => {
    const { code } = await bundleWorkflowCode({
      workflowsPath: join(ROOT, "packages/workflows/src/workflows.ts"),
    });
    expect(code.length).toBeGreaterThan(0);
    expect(code).toMatch(/wp0SmokeWorkflow/);
  });
});
