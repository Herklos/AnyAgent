import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GuardFinding {
  file: string;
  setting: string;
  detail: string;
}

export class ConfigGuardError extends Error {
  readonly findings: GuardFinding[];
  constructor(findings: GuardFinding[]) {
    const first = findings[0];
    super(
      first
        ? `unsafe harness config: ${first.file}: ${first.setting} (${first.detail})`
        : "unsafe harness config",
    );
    this.name = "ConfigGuardError";
    this.findings = findings;
  }
}

function readText(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Inspect configs that would be loaded for a read_only start; refuse if auto-approve settings are present. */
export function assertSafeReadOnlyConfig(opts: {
  harnessId: string;
  /** Controlled home path (inspected first). */
  home: string;
  /** Optional real home when isolation is incomplete. */
  realHome?: string;
}): void {
  const findings: GuardFinding[] = [];
  const homes = [
    opts.home,
    ...(opts.realHome && opts.realHome !== opts.home ? [opts.realHome] : []),
  ];

  for (const home of homes) {
    switch (opts.harnessId) {
      case "claude-code":
        findings.push(...scanClaude(home));
        break;
      case "codex":
        findings.push(...scanCodex(home));
        break;
      case "grok":
        findings.push(...scanGrok(home));
        break;
      case "vibe":
        findings.push(...scanVibe(home));
        break;
      default:
        break;
    }
  }

  if (findings.length) throw new ConfigGuardError(findings);
}

function scanClaude(home: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    const file = join(home, rel);
    const text = readText(file);
    if (!text) continue;
    try {
      const json = JSON.parse(text) as {
        permissions?: { allow?: unknown; defaultMode?: string };
        defaultMode?: string;
      };
      const allow = json.permissions?.allow;
      if (Array.isArray(allow) && allow.length > 0) {
        out.push({ file, setting: "permissions.allow", detail: `${allow.length} allow rule(s)` });
      }
      const mode = json.permissions?.defaultMode ?? json.defaultMode;
      if (typeof mode === "string" && /bypass|accept|auto/i.test(mode)) {
        out.push({ file, setting: "defaultMode", detail: mode });
      }
    } catch {
      // ignore unreadable JSON
    }
  }
  return out;
}

function scanCodex(home: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  for (const rel of [".codex/config.toml", "config.toml"]) {
    const file = join(home, rel);
    const text = readText(file);
    if (!text) continue;
    const ap = text.match(/approval_policy\s*=\s*"([^"]+)"/);
    if (ap?.[1] && ap[1] !== "untrusted") {
      out.push({ file, setting: "approval_policy", detail: ap[1] });
    }
    const sm = text.match(/sandbox_mode\s*=\s*"([^"]+)"/);
    if (sm?.[1] && sm[1] !== "read-only") {
      out.push({ file, setting: "sandbox_mode", detail: sm[1] });
    }
  }
  return out;
}

function scanGrok(home: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  const file = join(home, ".grok", "config.toml");
  const text = readText(file);
  if (!text) return out;
  if (/permission_mode\s*=\s*"?always-approve"?/i.test(text) || /always-approve/i.test(text)) {
    out.push({ file, setting: "permission_mode/always-approve", detail: "auto-approve enabled" });
  }
  if (/allow\s*=/.test(text) && /permission/i.test(text)) {
    out.push({ file, setting: "allow rules", detail: "permission allow rules present" });
  }
  return out;
}

function scanVibe(home: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  for (const rel of ["config.toml", ".vibe/config.toml"]) {
    const file = join(home, rel);
    const text = readText(file);
    if (!text) continue;
    const agent = text.match(/default_agent\s*=\s*"([^"]+)"/);
    if (agent?.[1] && agent[1] !== "ask") {
      out.push({ file, setting: "default_agent", detail: agent[1] });
    }
    if (/enable_auto_approve\s*=\s*true/i.test(text)) {
      out.push({ file, setting: "enable_auto_approve", detail: "true" });
    }
    if (/permission\s*=\s*"always"/i.test(text)) {
      out.push({ file, setting: "tools.*.permission", detail: "always" });
    }
  }
  return out;
}
