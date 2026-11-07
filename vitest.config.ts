import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = dirname(fileURLToPath(import.meta.url));

const packages = [
  { name: "@anyagent/core", dir: "packages/core" },
  { name: "@anyagent/backend", dir: "packages/backend" },
  { name: "@anyagent/backend-anytype", dir: "packages/backend-anytype" },
  { name: "@anyagent/admin", dir: "packages/admin" },
  { name: "@anyagent/workflows", dir: "packages/workflows" },
  { name: "@anyagent/harness", dir: "packages/harness" },
  { name: "@anyagent/gateway", dir: "packages/gateway" },
  { name: "@anyagent/node", dir: "packages/node" },
  { name: "anyagent", dir: "apps/cli" },
  { name: "@anyagent/e2e", dir: "e2e" },
  { name: "workspace-scripts", dir: "." },
] as const;

export default defineConfig({
  root: workspaceRoot,
  test: {
    projects: packages.map((p) => ({
      test: {
        name: p.name,
        root: join(workspaceRoot, p.dir),
        include: ["test/**/*.test.ts"],
        environment: "node",
      },
    })),
  },
});
