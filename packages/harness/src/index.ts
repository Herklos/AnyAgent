/** Package marker for WP0 workspace smoke. */
export const HARNESS_PACKAGE = "@anyagent/harness" as const;

export * from "./acp.js";
export * from "./codex.js";
export * from "./config-guard.js";
export type { FakeScript, FakeStep, FakeTurn } from "./fake-agent.js";
export {
  HarnessError,
  type HeadlessCliDescriptor,
  HeadlessCliSession,
  type HeadlessOutputMode,
  parseVibeOutput,
  vibeDescriptor,
} from "./headless-cli.js";
export * from "./home.js";
export * from "./jsonrpc-child.js";
export * from "./registry.js";
export * from "./types.js";
