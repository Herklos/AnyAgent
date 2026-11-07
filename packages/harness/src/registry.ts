/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/registry.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: drop opencode; add vibe/startSession/auth descriptors; import paths .js; package rename
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpSession } from "./acp.js";
import { CodexSession } from "./codex.js";
import { assertSafeReadOnlyConfig } from "./config-guard.js";
import { HeadlessCliSession, vibeDescriptor } from "./headless-cli.js";
import type { HarnessAuthDescriptor } from "./home.js";
import type { HarnessSession, SessionInit } from "./types.js";

export interface SpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HarnessDescriptor {
  id: string;
  label: string;
  protocol?: "acp" | "codex-app-server" | "headless-cli";
  /** When false, ask/auto modes are refused (ADR 0020). Default true for ACP/Codex. */
  permissionCallbacks?: boolean;
  spawn(init: SessionInit): SpawnSpec;
  sessionMeta?(init: SessionInit): Record<string, unknown> | undefined;
  authMethod?(methods: { id: string }[], init: SessionInit): string | undefined;
  modes?: { ask: string; full?: string };
  controlPaths?: readonly string[];
  auth: HarnessAuthDescriptor;
  /** Moves to v1 when isolation/live control is not proven. */
  shipping?: "v0" | "v1";
  shippingReason?: string;
}

const require = createRequire(import.meta.url);

function resolveBin(pkg: string, bin: string): string {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const rel = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
  if (!rel) throw new Error(`${pkg} has no bin ${bin}`);
  return join(dirname(pkgJson), rel);
}

export const claudeCode: HarnessDescriptor = {
  id: "claude-code",
  label: "Claude Code",
  spawn: (init) => ({
    command: process.execPath,
    args: [resolveBin("@agentclientprotocol/claude-agent-acp", "claude-agent-acp")],
    env: {
      ...(init.model ? { ANTHROPIC_MODEL: init.model } : {}),
      ...(init.effort ? { CLAUDE_CODE_EFFORT_LEVEL: init.effort } : {}),
    },
  }),
  sessionMeta: (init) =>
    init.instructions ? { systemPrompt: { append: init.instructions } } : undefined,
  modes: { ask: "default", full: "bypassPermissions" },
  controlPaths: [".claude", ".mcp.json"],
  auth: {
    auth: "both",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    // Live pass must confirm real credential paths before copying; empty until then.
    credentialPaths: [],
  },
  shipping: "v0",
};

function fakeAgentMain(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [
    join(here, "fake-agent-main.js"),
    join(here, "..", "dist", "fake-agent-main.js"),
  ]) {
    if (existsSync(c)) return c;
  }
  throw new Error("fake-agent-main.js not found; build @anyagent/harness first");
}

export const fakeAgent: HarnessDescriptor = {
  id: "fake",
  label: "Fake (scripted)",
  spawn: (init) => ({
    command: process.execPath,
    args: [fakeAgentMain()],
    env: init.env ?? {},
  }),
  controlPaths: [],
  auth: { auth: "none", credentialPaths: [] },
  shipping: "v0",
};

export function customHarness(
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): HarnessDescriptor {
  return {
    id: "custom",
    label: command,
    spawn: () => ({ command, args, env }),
    auth: { auth: "none", credentialPaths: [] },
  };
}

export const codex: HarnessDescriptor = {
  id: "codex",
  label: "Codex",
  protocol: "codex-app-server",
  spawn: () => ({
    command: "codex",
    args: [
      "app-server",
      "-c",
      "features.hooks=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.apps=false",
    ],
  }),
  controlPaths: [".codex"],
  auth: {
    auth: "both",
    apiKeyEnv: "OPENAI_API_KEY",
    credentialPaths: [],
  },
  shipping: "v0",
};

export const grokBuild: HarnessDescriptor = {
  id: "grok",
  label: "Grok Build",
  spawn: (init) => ({
    command: "grok",
    args: ["--no-auto-update", ...(init.model ? ["-m", init.model] : []), "agent", "stdio"],
  }),
  authMethod: (methods, init) => {
    const ids = new Set(methods.map((m) => m.id));
    const key = (init.env ?? process.env).XAI_API_KEY;
    if (key && ids.has("xai.api_key")) return "xai.api_key";
    if (ids.has("cached_token")) return "cached_token";
    return undefined;
  },
  auth: {
    auth: "both",
    apiKeyEnv: "XAI_API_KEY",
    credentialPaths: [],
  },
  // Not proven live (Michel audit G172); ship only after spike 007 or move to v1.
  shipping: "v1",
  shippingReason: "Grok Build not run live at Michel@402865d (audit G172); spike 007 NOT RUN here",
};

export const vibe: HarnessDescriptor = {
  id: "vibe",
  label: "Mistral Vibe",
  protocol: "headless-cli",
  permissionCallbacks: false,
  spawn: (init) => {
    const mode = init.approvalMode === "full" ? "full" : "read_only";
    const d = vibeDescriptor();
    return {
      command: d.command,
      args: d.buildArgs({
        prompt: "",
        mode,
        ...(init.model ? { model: init.model } : {}),
        output: d.output,
      }),
      env: { ...(init.env ?? {}) },
    };
  },
  auth: {
    auth: "api_key",
    apiKeyEnv: "MISTRAL_API_KEY",
    credentialPaths: [],
  },
  shipping: "v1",
  shippingReason: "Vibe live spike 007 NOT RUN; headless kind tested on fixtures only",
};

const REGISTRY: Record<string, HarnessDescriptor> = {
  grok: grokBuild,
  "claude-code": claudeCode,
  codex,
  vibe,
  fake: fakeAgent,
};

export function descriptorFor(
  id: string,
  opts?: { command?: string; args?: string[]; env?: Record<string, string> },
): HarnessDescriptor {
  if (id === "custom") {
    if (!opts?.command) throw new Error("a custom harness needs a command");
    return customHarness(opts.command, opts.args, opts.env);
  }
  const d = REGISTRY[id];
  if (!d)
    throw new Error(`unknown harness ${id}; known: ${Object.keys(REGISTRY).join(", ")}, custom`);
  return d;
}

export type V0ApprovalMode = "read_only" | "full";

/** Map v0 approval mode to spawn/session flags (assertable without starting a process). */
export function spawnPlanFor(
  harnessId: string,
  mode: V0ApprovalMode | "ask" | "auto",
  init: Pick<SessionInit, "cwd" | "model" | "env">,
): SpawnSpec & { sandbox?: string; agentFlag?: string } {
  const desc = descriptorFor(harnessId);
  if (desc.permissionCallbacks === false && (mode === "ask" || mode === "auto")) {
    throw new Error(`${desc.id} has no permission callbacks; ask/auto are refused (ADR 0020)`);
  }
  if (mode !== "read_only" && mode !== "full") {
    throw new Error(`spawnPlanFor expects read_only|full for flag mapping, got ${mode}`);
  }

  if (harnessId === "codex") {
    const sandbox = mode === "full" ? "danger-full-access" : "read-only";
    return {
      command: "codex",
      args: [
        "app-server",
        "-c",
        "features.hooks=false",
        "-c",
        `approval_policy=${mode === "full" ? "never" : "untrusted"}`,
        "-c",
        `sandbox_mode=${sandbox}`,
      ],
      sandbox,
    };
  }

  if (harnessId === "claude-code") {
    const base = desc.spawn({ ...init, approvalMode: mode });
    return {
      ...base,
      // Host denies in read_only; Claude started in ask (`default`) so requests reach the host.
      agentFlag: desc.modes?.ask ?? "default",
    };
  }

  if (harnessId === "grok") {
    const base = desc.spawn({ ...init, approvalMode: mode });
    const sandboxArg = mode === "full" ? "off" : "read-only";
    return {
      command: base.command,
      args: [...base.args, "--sandbox", sandboxArg],
      sandbox: sandboxArg,
    };
  }

  if (harnessId === "vibe") {
    const d = vibeDescriptor();
    const args = d.buildArgs({
      prompt: "__plan__",
      mode,
      ...(init.model ? { model: init.model } : {}),
      output: d.output,
    });
    return {
      command: d.command,
      args,
      env: { VIBE_HOME: init.env?.VIBE_HOME ?? "", ...(init.env ?? {}) },
      agentFlag: mode === "read_only" ? "ask" : "auto-approve",
    };
  }

  return desc.spawn({ ...init, approvalMode: mode });
}

/**
 * Open a harness session for the node. Maps approvalMode to the per-harness table;
 * runs the config guard for read_only; refuses ask/auto on headless kinds.
 */
export async function startSession(
  harnessId: string,
  init: SessionInit,
  opts?: { resumeSessionId?: string; skipGuard?: boolean },
): Promise<{ session: HarnessSession; resumed: string }> {
  const mode = init.approvalMode ?? "read_only";
  if (mode === "ask" || mode === "auto") {
    const desc = descriptorFor(harnessId);
    if (desc.permissionCallbacks === false) {
      throw new Error(`${harnessId} has no permission callbacks; ask/auto are refused (ADR 0020)`);
    }
  }
  if (mode !== "read_only" && mode !== "full" && mode !== "ask" && mode !== "auto") {
    throw new Error(`unsupported approval mode: ${String(mode)}`);
  }

  const desc = descriptorFor(harnessId);
  if (desc.shipping === "v1") {
    throw new Error(`${desc.id} moves to v1: ${desc.shippingReason ?? "not shipped in v0"}`);
  }

  const v0Mode: V0ApprovalMode = mode === "full" ? "full" : "read_only";
  if (v0Mode === "read_only" && !opts?.skipGuard && init.env?.HOME) {
    assertSafeReadOnlyConfig({ harnessId, home: init.env.HOME });
  }

  if (desc.protocol === "codex-app-server") {
    const opened = await CodexSession.open(
      { ...init, approvalMode: v0Mode },
      opts?.resumeSessionId,
    );
    return { session: opened.session, resumed: opened.resumed };
  }

  if (desc.protocol === "headless-cli") {
    if (mode === "ask" || mode === "auto") {
      throw new Error(`${harnessId} has no permission callbacks; ask/auto are refused`);
    }
    const session = new HeadlessCliSession(vibeDescriptor(), init, v0Mode, opts?.resumeSessionId);
    return { session, resumed: opts?.resumeSessionId ? "resume" : "none" };
  }

  const opened = await AcpSession.open(
    desc,
    { ...init, approvalMode: v0Mode },
    opts?.resumeSessionId,
  );
  return { session: opened.session as unknown as HarnessSession, resumed: opened.resumed };
}
