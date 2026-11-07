/**
 * Floor and path-policy exports for permission decisions.
 * Copied modules live beside this barrel; see each file's provenance header.
 */
export {
  askReason,
  denyMatch,
  type FloorContext,
  fileFloorReason,
  floorReason,
  hardFloorReason,
} from "./command-floor.js";
export {
  commandAllowed,
  HARMLESS_REDIRECT,
  type Segment,
  SHELL_WRAPPER,
  splitCommand,
  unquoteWord,
} from "./command-policy.js";
export {
  FILE_EDIT_TOOLS,
  fileEditTarget,
  fileScopeAllowed,
  isFileEditTool,
  OWN_TASK_WORKTREES,
  type PathScope,
  withinTaskWorktree,
} from "./path-policy.js";
