import type { Backend } from "@anyagent/backend";
import { type AgentSpec, type ApprovalMode, type HarnessId, parseAgentSpec } from "@anyagent/core";

const HANDLE_RE = /^[a-z][a-z0-9-]{1,30}$/;

const DEFAULT_BODY =
  "You answer questions about this machine. You are read-only by default: do not write files or run destructive commands unless the owner changes your approval mode.";

export interface CreateAgentOpts {
  handle: string;
  harness: HarnessId;
  model?: string;
  mode?: ApprovalMode;
  workdir?: string;
  allowedAuthors?: string[];
}

export async function createAgent(
  backend: Backend,
  opts: CreateAgentOpts,
): Promise<{ agentId: string; chatId: string }> {
  if (!HANDLE_RE.test(opts.handle)) {
    throw new Error(`invalid handle: ${opts.handle}`);
  }
  // Duplicate-handle check is list-then-create (CLI race is acceptable for v0).
  const existing = await backend.org.list("aa_agent", { aa_handle: opts.handle });
  if (existing.length > 0) {
    throw new Error(`duplicate handle: ${opts.handle}`);
  }

  // Object first (repairable if a later step fails). Chat second, then link.
  const fields: Record<string, string> = {
    aa_handle: opts.handle,
    aa_harness: opts.harness,
    aa_chat: "",
    aa_approval_mode: opts.mode ?? "read_only",
    aa_lifecycle: "live",
    aa_model: opts.model ?? "",
    aa_workdir: opts.workdir ?? "",
    aa_allowed_authors: (opts.allowedAuthors ?? []).join(","),
  };
  const obj = await backend.objects.create("aa_agent", {
    name: opts.handle,
    fields,
    body: DEFAULT_BODY,
  });
  try {
    const chatId = await backend.chat.create({ name: `agent:${opts.handle}` });
    await backend.objects.update(obj.id, { aa_chat: chatId });
    return { agentId: obj.id, chatId };
  } catch (err) {
    // Leave the agent object for the operator to repair or delete; no orphan chat.
    throw err;
  }
}

export async function listAgents(
  backend: Backend,
): Promise<Array<{ id: string; spec?: AgentSpec; error?: string }>> {
  const rows = await backend.org.list("aa_agent");
  const out: Array<{ id: string; spec?: AgentSpec; error?: string }> = [];
  for (const row of rows) {
    const full = (await backend.org.get(row.id)) ?? row;
    const parsed = parseAgentSpec(full, full.body);
    if (parsed.ok) out.push({ id: full.id, spec: parsed.spec });
    else {
      out.push({
        id: full.id,
        error: parsed.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
      });
    }
  }
  return out;
}
