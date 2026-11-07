export {
  CHECKS,
  type Check,
  type Ctx,
  type Result,
  runConformance,
  runSuite,
  SCHEMA,
} from "./conformance/index.js";
export * from "./errors.js";
export { MemoryBackend, type MemoryOptions } from "./memory-backend.js";
export * from "./port.js";
export * from "./queue.js";

/** Package marker for WP0 workspace smoke. */
export const BACKEND_PACKAGE = "@anyagent/backend" as const;
