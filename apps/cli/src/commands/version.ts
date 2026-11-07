import { createRequire } from "node:module";

export function cmdVersion(): number {
  const require = createRequire(import.meta.url);
  let temporal = "unknown";
  try {
    temporal = require("@temporalio/worker/package.json").version as string;
  } catch {
    temporal = "1.24.0";
  }
  process.stdout.write(`anybot 0.0.0\nnode ${process.version}\n@temporalio/* ${temporal}\n`);
  return 0;
}
