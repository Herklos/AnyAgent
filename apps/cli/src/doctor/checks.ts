import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Backend, SchemaAdmin } from "@anyagent/backend";
import type { AnyagentConfig } from "@anyagent/core";
import { parseAgentSpec, resolveApprovers, SCHEMA_VERSION } from "@anyagent/core";
import { assertSafeReadOnlyConfig, ConfigGuardError, descriptorFor } from "@anyagent/harness";
import type { DoctorCheckResult } from "./types.js";

export interface DoctorDeps {
  config: AnyagentConfig;
  configPath: string;
  backends: Map<string, Backend & SchemaAdmin & { meta?: { verified?: boolean } }>;
  orgIds: string[];
  /** Override Temporal reachability (tests). */
  temporalReachable?: () => Promise<{ ok: boolean; detail: string }>;
  /** Override harness --version (tests). */
  harnessVersion?: (id: string) => Promise<{ ok: boolean; detail: string }>;
  /** Override which harnesses agents use (tests). */
  agentHarnesses?: () => Promise<
    Array<{ orgId: string; handle: string; harness: string; mode: string; workdir?: string }>
  >;
  /** Home dirs for D8 (tests). */
  guardHome?: string;
}

function orgBackend(deps: DoctorDeps, orgId: string) {
  const b = deps.backends.get(orgId);
  if (!b) throw new Error(`no backend for org ${orgId}`);
  return b;
}

export async function checkD1(deps: DoctorDeps): Promise<DoctorCheckResult> {
  try {
    // Config already loaded; re-validate path exists.
    if (!existsSync(deps.configPath)) {
      return {
        id: "D1",
        severity: "fail",
        message: `config missing at ${deps.configPath}`,
        fix: "pass --config or create anybot.config.yaml",
      };
    }
    return { id: "D1", severity: "pass", message: `config ok (${deps.configPath})` };
  } catch (err) {
    return {
      id: "D1",
      severity: "fail",
      message: err instanceof Error ? err.message : String(err),
      fix: "fix every listed config error",
    };
  }
}

export async function checkD2(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const notes: string[] = [];
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    try {
      const self = await b.identity.self();
      notes.push(`${orgId}: ok as ${self.id}`);
      if (b.meta && b.meta.verified === false) {
        return {
          id: "D2",
          severity: "warn",
          message: `${orgId}: backend reachable but unverified (spike 002 NOT RUN)`,
          fix: "run the live Anytype conformance when a throwaway instance is available",
        };
      }
    } catch (err) {
      return {
        id: "D2",
        severity: "fail",
        message: `${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        fix: "check the key env vars and that anytype serve is running",
      };
    }
  }
  return { id: "D2", severity: "pass", message: notes.join("; ") || "backends ok" };
}

export async function checkD3(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    try {
      const self = await b.identity.self();
      const role = await b.identity.roleOf(self.id);
      if (role === "reader" || role === "guest") {
        return {
          id: "D3",
          severity: "fail",
          message: `${orgId}: role ${role ?? "unknown"} cannot write`,
          fix: "use a key with writer/admin/owner on the space",
        };
      }
      if (!role && b.capabilities.has("roles")) {
        return {
          id: "D3",
          severity: "fail",
          message: `${orgId}: not a member of the space`,
          fix: "join the space with the bot account",
        };
      }
    } catch (err) {
      return {
        id: "D3",
        severity: "fail",
        message: `${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        fix: "join the space or fix membership",
      };
    }
  }
  return { id: "D3", severity: "pass", message: "membership and write role ok" };
}

export async function checkD4(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    const settings = await b.org.list("aa_settings");
    if (settings.length === 0) {
      return {
        id: "D4",
        severity: "fail",
        message: `${orgId}: schema not initialised`,
        fix: "run anybot init",
      };
    }
    const ver = String(settings[0]?.fields.aa_schema_version ?? "");
    if (ver && compareSemver(ver, SCHEMA_VERSION) > 0) {
      return {
        id: "D4",
        severity: "fail",
        message: `${orgId}: schema ${ver} newer than program ${SCHEMA_VERSION}`,
        fix: "upgrade anybot",
      };
    }
    if (ver && compareSemver(ver, SCHEMA_VERSION) < 0) {
      return {
        id: "D4",
        severity: "warn",
        message: `${orgId}: schema ${ver} older than program ${SCHEMA_VERSION}`,
        fix: "run anybot init to upgrade",
      };
    }
  }
  return { id: "D4", severity: "pass", message: `schema ${SCHEMA_VERSION}` };
}

export async function checkD5(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    try {
      const chatId = await b.chat.general();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1500);
      try {
        // Short probe: start a watch and abort — success means streams (or polling) work.
        const iter = b.events.watch({ kind: "chat", chatId }, { signal: ac.signal });
        await iter[Symbol.asyncIterator]().next();
      } catch (err) {
        if (ac.signal.aborted) {
          // aborted after starting is fine
        } else {
          return {
            id: "D5",
            severity: "fail",
            message: `${orgId}: chat stream probe failed: ${err instanceof Error ? err.message : String(err)}`,
            fix: "enable streams in anytype serve, or confirm polling is configured",
          };
        }
      } finally {
        clearTimeout(timer);
        ac.abort();
      }
    } catch (err) {
      return {
        id: "D5",
        severity: "fail",
        message: `${orgId}: ${err instanceof Error ? err.message : String(err)}`,
        fix: "enable chat streams in anytype serve",
      };
    }
  }
  return { id: "D5", severity: "pass", message: "chat stream probe ok" };
}

export async function checkD6(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const probe =
    deps.temporalReachable ??
    (async () => {
      try {
        const { Connection } = await import("@temporalio/client");
        const c = await Connection.connect({ address: deps.config.temporal.address });
        await c.ensureConnected();
        c.close();
        return { ok: true, detail: `reachable at ${deps.config.temporal.address}` };
      } catch (err) {
        return {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    });
  const r = await probe();
  if (!r.ok) {
    return {
      id: "D6",
      severity: "fail",
      message: `Temporal unreachable: ${r.detail}`,
      fix: "start Temporal or fix temporal.address / namespace",
    };
  }
  return { id: "D6", severity: "pass", message: r.detail };
}

export async function checkD7(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const agents = (await deps.agentHarnesses?.()) ?? (await listAgentHarnesses(deps));
  const seen = new Set<string>();
  for (const a of agents) {
    if (a.harness === "fake") continue;
    if (seen.has(a.harness)) continue;
    seen.add(a.harness);
    const probe =
      deps.harnessVersion ??
      (async (id: string) => {
        try {
          descriptorFor(id);
          const { spawnSync } = await import("node:child_process");
          const cmd = id === "claude-code" ? "claude" : id === "vibe" ? "vibe" : id;
          const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 5_000 });
          if (r.error || r.status !== 0) {
            return { ok: false, detail: r.error?.message ?? (r.stderr || "not installed") };
          }
          return { ok: true, detail: (r.stdout || r.stderr).trim().slice(0, 120) };
        } catch (err) {
          return { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
      });
    const r = await probe(a.harness);
    if (!r.ok) {
      return {
        id: "D7",
        severity: "fail",
        message: `${a.harness}: ${r.detail}`,
        fix: `install ${a.harness} and sign in or set its API key env`,
      };
    }
  }
  return {
    id: "D7",
    severity: "pass",
    message: seen.size ? `harnesses ok: ${[...seen].join(", ")}` : "no shipping harnesses in use",
  };
}

export async function checkD8(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const agents = (await deps.agentHarnesses?.()) ?? (await listAgentHarnesses(deps));
  const home = deps.guardHome ?? deps.config.state.dir;
  for (const a of agents) {
    if (a.mode !== "read_only") continue;
    if (a.harness === "fake") continue;
    try {
      assertSafeReadOnlyConfig({ harnessId: a.harness, home });
    } catch (err) {
      if (err instanceof ConfigGuardError) {
        const f = err.findings[0];
        return {
          id: "D8",
          severity: "fail",
          message: `${a.handle}: ${err.message}`,
          fix: f
            ? `remove ${f.setting} from ${f.file}`
            : "remove auto-approving settings from the harness config",
        };
      }
      throw err;
    }
  }
  return { id: "D8", severity: "pass", message: "read_only agents have no auto-approve config" };
}

export async function checkD9(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const agents = (await deps.agentHarnesses?.()) ?? (await listAgentHarnesses(deps));
  const roots = deps.config.node.workdirRoots;
  for (const a of agents) {
    const wd = a.workdir;
    if (!wd || !wd.trim()) continue;
    const abs = isAbsolute(wd) ? wd : resolve(wd);
    if (!existsSync(abs)) {
      return {
        id: "D9",
        severity: "fail",
        message: `${a.handle}: aa_workdir ${abs} does not exist`,
        fix: "create the directory or fix aa_workdir",
      };
    }
    const ok = roots.some((r) => abs === r || abs.startsWith(r.endsWith("/") ? r : `${r}/`));
    if (!ok) {
      return {
        id: "D9",
        severity: "fail",
        message: `${a.handle}: aa_workdir ${abs} outside node.workdirRoots`,
        fix: "fix the path or extend node.workdirRoots",
      };
    }
  }
  return { id: "D9", severity: "pass", message: "agent workdirs ok" };
}

export async function checkD10(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    // MemoryBackend always has modifiedById; treat missing "roles" + no modifier evidence as warn.
    // WP2: when backend cannot show who changed an agent, warn.
    const sample = await b.org.list("aa_agent");
    if (sample.length === 0) continue;
    const full = await b.org.get(sample[0]!.id);
    if (!full?.modifiedById) {
      return {
        id: "D10",
        severity: "warn",
        message: `${orgId}: backend cannot show who last edited an agent`,
        fix: "share the space only with people you trust",
      };
    }
  }
  return { id: "D10", severity: "pass", message: "last-modifier visible" };
}

export async function checkD11(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const org of deps.config.orgs) {
    if (!deps.orgIds.includes(org.id)) continue;
    if (org.backend.readKeyEnv === org.backend.writeKeyEnv) {
      return {
        id: "D11",
        severity: "warn",
        message: `${org.id}: same env for read and write (${org.backend.readKeyEnv})`,
        fix: "use a read-only key for the gateway when you can",
      };
    }
  }
  return { id: "D11", severity: "pass", message: "read/write keys separated" };
}

export async function checkD12(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const errors: string[] = [];
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    const rows = await b.org.list("aa_agent");
    for (const row of rows) {
      const full = (await b.org.get(row.id)) ?? row;
      const parsed = parseAgentSpec(full, full.body);
      if (!parsed.ok) {
        errors.push(
          `${orgId}/${row.id}: ${parsed.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
        );
      }
    }
  }
  if (errors.length) {
    return {
      id: "D12",
      severity: "fail",
      message: errors.join(" | "),
      fix: "edit the aa_agent object fields until parseAgentSpec accepts them",
    };
  }
  return { id: "D12", severity: "pass", message: "all aa_agent specs parse" };
}

async function listAgentHarnesses(deps: DoctorDeps) {
  const out: Array<{
    orgId: string;
    handle: string;
    harness: string;
    mode: string;
    workdir?: string;
  }> = [];
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    const rows = await b.org.list("aa_agent");
    for (const row of rows) {
      const full = (await b.org.get(row.id)) ?? row;
      const parsed = parseAgentSpec(full, full.body);
      if (!parsed.ok) continue;
      out.push({
        orgId,
        handle: parsed.spec.handle,
        harness: parsed.spec.harness,
        mode: parsed.spec.approvalMode,
        ...(parsed.spec.workdir ? { workdir: parsed.spec.workdir } : {}),
      });
    }
  }
  return out;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Approvers present and not agent accounts. */
export async function checkD13(deps: DoctorDeps): Promise<DoctorCheckResult> {
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    const settings = await b.org.list("aa_settings");
    if (settings.length === 0) {
      return {
        id: "D13",
        severity: "fail",
        message: `${orgId}: no aa_settings`,
        fix: "run anybot init",
      };
    }
    const self = await b.identity.self();
    const org = deps.config.orgs.find((o) => o.id === orgId);
    const owners = org?.owners ?? [self.id];
    const agentAccounts = [self.id];
    const raw = String(settings[0]?.fields.aa_approvers ?? "");
    const resolved = resolveApprovers({
      settingsApprovers: raw,
      owners,
      agentAccounts,
    });
    if (resolved.refused.some((r) => r.reason === "agent-account")) {
      return {
        id: "D13",
        severity: "fail",
        message: `${orgId}: aa_approvers names agent account(s): ${resolved.refused
          .filter((r) => r.reason === "agent-account")
          .map((r) => r.id)
          .join(", ")}`,
        fix: "remove agent accounts from aa_approvers",
      };
    }
    if (resolved.approvers.length === 0) {
      return {
        id: "D13",
        severity: "fail",
        message: `${orgId}: no eligible approvers`,
        fix: "set aa_approvers to person participant ids, or ensure owners are people",
      };
    }
  }
  return { id: "D13", severity: "pass", message: "approvers ok (people only)" };
}

/** approvalTtlMinutes must be less than turnTimeoutMin. */
export async function checkD14(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const ttl = deps.config.tuning.approvalTtlMinutes;
  const turn = deps.config.tuning.turnTimeoutMin;
  if (ttl >= turn) {
    return {
      id: "D14",
      severity: "fail",
      message: `approvalTtlMinutes (${ttl}) must be less than turnTimeoutMin (${turn})`,
      fix: "lower tuning.approvalTtlMinutes or raise turnTimeoutMin",
    };
  }
  return {
    id: "D14",
    severity: "pass",
    message: `approval TTL ${ttl}m < turn timeout ${turn}m`,
  };
}

/** Pending aa_approval past aa_expires_at (lost workflow). */
export async function checkD15(deps: DoctorDeps): Promise<DoctorCheckResult> {
  const stuck: string[] = [];
  const now = Date.now();
  for (const orgId of deps.orgIds) {
    const b = orgBackend(deps, orgId);
    const rows = await b.org.list("aa_approval", { aa_status: "pending" });
    for (const row of rows) {
      const expires = String(row.fields.aa_expires_at ?? "");
      const t = Date.parse(expires);
      if (!Number.isNaN(t) && t < now) {
        stuck.push(`${orgId}:${row.id}`);
      }
    }
  }
  if (stuck.length) {
    return {
      id: "D15",
      severity: "warn",
      message: `pending approvals past expiry: ${stuck.join(", ")}`,
      fix: "inspect the workflow; mark expired or re-decide manually if needed",
    };
  }
  return { id: "D15", severity: "pass", message: "no stuck pending approvals" };
}

export const ALL_CHECKS = [
  checkD1,
  checkD2,
  checkD3,
  checkD4,
  checkD5,
  checkD6,
  checkD7,
  checkD8,
  checkD9,
  checkD10,
  checkD11,
  checkD12,
  checkD13,
  checkD14,
  checkD15,
] as const;

/** Subset run must pass before starting (D1–D4, D6). */
export const RUN_GATE_CHECKS = [checkD1, checkD2, checkD3, checkD4, checkD6] as const;
