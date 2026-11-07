import type { ObjectRecord } from "@anyagent/backend";

export type HarnessId = "claude-code" | "codex" | "grok" | "vibe";
export type ApprovalMode = "read_only" | "full";
export type Lifecycle = "live" | "paused";

export interface AgentSpec {
  handle: string;
  harness: HarnessId;
  model?: string;
  chatId: string;
  approvalMode: ApprovalMode;
  allowedAuthors: string[];
  lifecycle: Lifecycle;
  instructions: string;
  workdir?: string;
}

const HANDLE_RE = /^[a-z][a-z0-9-]{1,30}$/;
const HARNESSES = new Set<string>(["claude-code", "codex", "grok", "vibe"]);
const MODES = new Set<string>(["read_only", "full"]);
const LIFECYCLES = new Set<string>(["live", "paused"]);

export type ParseResult =
  | { ok: true; spec: AgentSpec }
  | { ok: false; errors: Array<{ field: string; message: string }> };

function readStringField(
  fields: Record<string, unknown>,
  key: string,
  errors: Array<{ field: string; message: string }>,
  opts: { required?: boolean; defaultValue?: string } = {},
): string {
  const raw = fields[key];
  if (raw === undefined || raw === null) {
    if (opts.required) {
      errors.push({ field: key, message: "required" });
      return "";
    }
    return opts.defaultValue ?? "";
  }
  if (typeof raw !== "string") {
    errors.push({
      field: key,
      message: `expected a string, got ${Array.isArray(raw) ? "array" : typeof raw}`,
    });
    return "";
  }
  return raw;
}

export function parseAgentSpec(record: ObjectRecord, body?: string): ParseResult {
  const errors: Array<{ field: string; message: string }> = [];
  const f = record.fields as Record<string, unknown>;

  const handle = readStringField(f, "aa_handle", errors, { required: true });
  if (handle && !HANDLE_RE.test(handle)) {
    errors.push({ field: "aa_handle", message: "must match ^[a-z][a-z0-9-]{1,30}$" });
  }

  const harness = readStringField(f, "aa_harness", errors, { required: true });
  if (harness && !HARNESSES.has(harness)) {
    errors.push({ field: "aa_harness", message: `unknown value ${harness}` });
  }

  const chatId = readStringField(f, "aa_chat", errors, { required: true });

  const modeRaw = readStringField(f, "aa_approval_mode", errors, { defaultValue: "read_only" });
  if (modeRaw && !MODES.has(modeRaw)) {
    errors.push({ field: "aa_approval_mode", message: `unknown value ${modeRaw}` });
  }

  // Lifecycle: only default when absent. Wrong type must not become "live".
  const lifeRaw = readStringField(f, "aa_lifecycle", errors, { defaultValue: "live" });
  if (lifeRaw && !LIFECYCLES.has(lifeRaw)) {
    errors.push({ field: "aa_lifecycle", message: `unknown value ${lifeRaw}` });
  }

  const authorsRaw = readStringField(f, "aa_allowed_authors", errors, { defaultValue: "" });
  const allowedAuthors = authorsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const modelRaw = readStringField(f, "aa_model", errors, { defaultValue: "" });
  const workdirRaw = readStringField(f, "aa_workdir", errors, { defaultValue: "" });
  const model = modelRaw || undefined;
  const workdir = workdirRaw || undefined;
  const instructions = body ?? record.body ?? "";

  if (errors.length) return { ok: false, errors };

  const spec: AgentSpec = {
    handle,
    harness: harness as HarnessId,
    chatId,
    approvalMode: modeRaw as ApprovalMode,
    allowedAuthors,
    lifecycle: lifeRaw as Lifecycle,
    instructions,
  };
  if (model !== undefined) spec.model = model;
  if (workdir !== undefined) spec.workdir = workdir;
  return { ok: true, spec };
}
