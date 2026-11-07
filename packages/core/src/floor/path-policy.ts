/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/core/src/path-policy.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; relocated under floor/
 */

// Path-scoped file approvals (audit G155). Pure string logic: the node resolves a target to its canonical
// path (symlinks and all) and calls these; the workflow only reads the node's verdict. Nothing here touches
// a file system, so it can run in workflow code.

/** The only value of `approvals.allow.paths` today: Edit and Write inside the agent's own task worktrees. */
export const OWN_TASK_WORKTREES = "own_task_worktrees";
export type PathScope = typeof OWN_TASK_WORKTREES;

/** The tool names the scope covers. Anything else never gets a path verdict. */
export const FILE_EDIT_TOOLS: readonly string[] = ["Edit", "Write"];

export const isFileEditTool = (toolName: string): boolean => FILE_EDIT_TOOLS.includes(toolName);

/** The path an Edit or Write call targets, or undefined if it is not a plain absolute path (fail closed). */
export function fileEditTarget(rawInput: unknown): string | undefined {
  if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput))
    return undefined;
  const p = (rawInput as Record<string, unknown>).file_path;
  if (typeof p !== "string" || p.trim() === "" || p.includes("\0")) return undefined;
  return p.startsWith("/") ? p : undefined;
}

const segments = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s !== "");

/**
 * True when `target` is a file inside `<tasksRoot>/<task>/<project>/`. Both paths must already be canonical
 * (absolute, symlinks resolved). The task folder, a project folder itself, a sibling that only shares a
 * name prefix, and anything under a `.git` entry are not inside.
 */
export function withinTaskWorktree(tasksRoot: string, target: string): boolean {
  const root = segments(tasksRoot);
  const t = segments(target);
  if (root.length === 0 || t.length < root.length + 3) return false;
  if (!root.every((s, i) => s === t[i])) return false;
  const rest = t.slice(root.length);
  return !rest.some((s) => s === "." || s === ".." || s === ".git");
}

/** Whether the owner enabled the scope and the node confirmed the target is inside it. */
export function fileScopeAllowed(
  allowPaths: readonly string[],
  toolName: string,
  verdict: string | undefined,
): boolean {
  return (
    allowPaths.includes(OWN_TASK_WORKTREES) &&
    isFileEditTool(toolName) &&
    verdict === OWN_TASK_WORKTREES
  );
}
