export const CORE_PACKAGE = "@anyagent/core" as const;
export {
  type AgentSpec,
  type ApprovalMode,
  type HarnessId,
  type Lifecycle,
  type ParseResult,
  parseAgentSpec,
} from "./agent-spec.js";
export {
  isAllowedAuthor,
  lastModifierAcceptable,
  type ModifierCheck,
} from "./author-policy.js";
export { TUNING_DEFAULTS } from "./config.js";
export { type AnyagentConfig, loadConfig } from "./config.js";
export { V0_SCHEMA, V0_SCHEMA_VERSION } from "./schema.js";
