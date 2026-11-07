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

export function parseAgentSpec(record: ObjectRecord, body?: string): ParseResult {
  const errors: Array<{ field: string; message: string }> = [];
  const f = record.fields;

  const handle = typeof f.aa_handle === "string" ? f.aa_handle : "";
  if (!HANDLE_RE.test(handle)) {
    errors.push({ field: "aa_handle", message: "must match ^[a-z][a-z0-9-]{1,30}$" });
  }

  const harness = typeof f.aa_harness === "string" ? f.aa_harness : "";
  if (!harness) errors.push({ field: "aa_harness", message: "required" });
  else if (!HARNESSES.has(harness)) {
    errors.push({ field: "aa_harness", message: `unknown value ${harness}` });
  }

  const chatId = typeof f.aa_chat === "string" ? f.aa_chat : "";
  if (!chatId) errors.push({ field: "aa_chat", message: "required" });

  const modeRaw = typeof f.aa_approval_mode === "string" ? f.aa_approval_mode : "read_only";
  if (!MODES.has(modeRaw)) {
    errors.push({ field: "aa_approval_mode", message: `unknown value ${modeRaw}` });
  }

  const lifeRaw = typeof f.aa_lifecycle === "string" ? f.aa_lifecycle : "live";
  if (!LIFECYCLES.has(lifeRaw)) {
    errors.push({ field: "aa_lifecycle", message: `unknown value ${lifeRaw}` });
  }

  const authorsRaw = typeof f.aa_allowed_authors === "string" ? f.aa_allowed_authors : "";
  const allowedAuthors = authorsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const model = typeof f.aa_model === "string" && f.aa_model ? f.aa_model : undefined;
  const workdir = typeof f.aa_workdir === "string" && f.aa_workdir ? f.aa_workdir : undefined;
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
