import { defineConfig } from "vitest/config";

const packages = [
  { name: "@anyagent/core", root: "packages/core" },
  { name: "@anyagent/backend", root: "packages/backend" },
  { name: "@anyagent/backend-anytype", root: "packages/backend-anytype" },
  { name: "@anyagent/admin", root: "packages/admin" },
  { name: "@anyagent/workflows", root: "packages/workflows" },
  { name: "@anyagent/harness", root: "packages/harness" },
  { name: "@anyagent/gateway", root: "packages/gateway" },
  { name: "@anyagent/node", root: "packages/node" },
  { name: "anyagent", root: "apps/cli" },
  { name: "@anyagent/e2e", root: "e2e" },
  { name: "workspace-scripts", root: "." },
] as const;

export default defineConfig({
  test: {
    projects: packages.map((p) => ({
      test: {
        name: p.name,
        root: p.root,
        include: p.root === "." ? ["test/**/*.test.ts"] : ["test/**/*.test.ts"],
        environment: "node",
      },
    })),
  },
});
