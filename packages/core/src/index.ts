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
export { type AnyagentConfig, loadConfig, TUNING_DEFAULTS } from "./config.js";
export {
  askReason,
  commandAllowed,
  denyMatch,
  type FloorContext,
  fileEditTarget,
  fileFloorReason,
  fileScopeAllowed,
  floorReason,
  hardFloorReason,
  isFileEditTool,
  OWN_TASK_WORKTREES,
  type PathScope,
} from "./floor/index.js";
export {
  decidePermission,
  type Mode,
  type PermissionDecisionResult,
  type PermissionKind,
  type PermissionRequest,
  READ_ONLY_KINDS,
} from "./permission.js";
export { V0_SCHEMA, V0_SCHEMA_VERSION } from "./schema.js";
