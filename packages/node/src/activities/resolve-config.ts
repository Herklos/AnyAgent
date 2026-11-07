import { isAbsolute, resolve } from "node:path";
import type { Backend } from "@anyagent/backend";
import { type AgentSpec, lastModifierAcceptable, parseAgentSpec } from "@anyagent/core";
import type { AgentSpecWire, ResolvedConfig } from "@anyagent/workflows";

export interface ResolveConfigDeps {
  backendForOrg: (orgId: string) => Backend;
  /** Org owner participant ids (from node config). */
  ownerIdsForOrg: (orgId: string) => string[];
  workdirRoots: string[];
  /** Directory used when aa_workdir is empty. */
  stateDir: string;
  /** When the backend cannot show modifiers, skip the editor check. */
  modifierCapable?: boolean;
}

function toWire(spec: AgentSpec): AgentSpecWire {
  const wire: AgentSpecWire = {
    handle: spec.handle,
    harness: spec.harness,
    chatId: spec.chatId,
    approvalMode: spec.approvalMode,
    allowedAuthors: [...spec.allowedAuthors],
    lifecycle: spec.lifecycle,
    instructions: spec.instructions,
  };
  if (spec.model !== undefined) wire.model = spec.model;
  if (spec.workdir !== undefined) wire.workdir = spec.workdir;
  return wire;
}

function workdirAllowed(
  workdir: string | undefined,
  roots: string[],
  stateDir: string,
  agentId: string,
):
  | {
      ok: true;
      workdir: string;
    }
  | { ok: false; detail: string } {
  if (!workdir || workdir.trim() === "") {
    return { ok: true, workdir: resolve(stateDir, "workdirs", agentId) };
  }
  const abs = isAbsolute(workdir) ? workdir : resolve(workdir);
  const ok = roots.some(
    (root) => abs === root || abs.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
  if (!ok) {
    return { ok: false, detail: `aa_workdir ${abs} is outside node.workdirRoots` };
  }
  return { ok: true, workdir: abs };
}

export function createResolveConfig(deps: ResolveConfigDeps) {
  return async function resolveConfig(i: {
    orgId: string;
    spaceId: string;
    agentId: string;
  }): Promise<ResolvedConfig> {
    void i.spaceId;
    const backend = deps.backendForOrg(i.orgId);
    const ownerIds = deps.ownerIdsForOrg(i.orgId);
    const record = await backend.org.get(i.agentId);
    if (!record) {
      return { ok: false, reason: "invalid", detail: `agent ${i.agentId} not found` };
    }
    const parsed = parseAgentSpec(record, record.body);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: "invalid",
        detail: parsed.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
      };
    }

    const capable = deps.modifierCapable ?? false;
    const mod = lastModifierAcceptable({
      capable,
      modifiedById: record.modifiedById,
      ownerIds,
      allowedAuthors: parsed.spec.allowedAuthors,
    });
    if (mod.result === "unknown-modifier-refused" || mod.result === "forbidden-modifier") {
      return {
        ok: false,
        reason: "unacceptable-editor",
        detail: `last modifier not acceptable (${mod.result})`,
      };
    }

    const wd = workdirAllowed(parsed.spec.workdir, deps.workdirRoots, deps.stateDir, i.agentId);
    if (!wd.ok) {
      return { ok: false, reason: "workdir-outside-roots", detail: wd.detail };
    }

    const spec = toWire(parsed.spec);
    spec.workdir = wd.workdir;
    return { ok: true, spec, ownerIds };
  };
}
