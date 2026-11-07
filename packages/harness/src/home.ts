import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type AuthMode = "login" | "api_key" | "both" | "none";

export interface HarnessAuthDescriptor {
  /** How this harness authenticates for v0. */
  auth: AuthMode;
  /** Env var name for an API key, if supported. */
  apiKeyEnv?: string;
  /**
   * Home-relative credential paths to copy (mode 0600) into the controlled home.
   * Empty until a live pass records the real names; never invent paths that were not observed.
   */
  credentialPaths: readonly string[];
  /**
   * When true, do not copy login files (refresh would invalidate the owner's session).
   * Set after a live finding; default false until proven.
   */
  loginCopyUnsafe?: boolean;
}

export interface ControlledHome {
  /** Absolute path of the agent's controlled home. */
  path: string;
  /** Env overlay: HOME (and harness-specific home vars) + optional API key. */
  env: Record<string, string>;
  /** Credential files that were actually copied (absolute paths under `path`). */
  copiedCredentials: string[];
}

/**
 * Create `<stateDir>/agents/<spaceId>/<agentId>/home` and optionally copy listed credentials
 * from the real home. Never writes into the real home.
 */
export function prepareControlledHome(opts: {
  stateDir: string;
  spaceId: string;
  agentId: string;
  auth: HarnessAuthDescriptor;
  /** Real home to copy from (defaults to os.homedir()). */
  realHome?: string;
  /** Extra env (e.g. API key already resolved). */
  env?: Record<string, string>;
  /** Harness-specific home env key (VIBE_HOME, etc.). Defaults to HOME only. */
  homeEnvKeys?: readonly string[];
}): ControlledHome {
  const homePath = join(opts.stateDir, "agents", opts.spaceId, opts.agentId, "home");
  mkdirSync(homePath, { recursive: true });

  const realHome = opts.realHome ?? homedir();
  const copied: string[] = [];
  const canCopyLogin =
    (opts.auth.auth === "login" || opts.auth.auth === "both") && !opts.auth.loginCopyUnsafe;

  if (canCopyLogin) {
    for (const rel of opts.auth.credentialPaths) {
      const src = resolve(realHome, rel);
      // Refuse path escape
      if (!src.startsWith(resolve(realHome) + "/") && src !== resolve(realHome)) {
        throw new Error(`credential path escapes real home: ${rel}`);
      }
      if (!existsSync(src)) continue;
      const dest = join(homePath, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      chmodSync(dest, 0o600);
      copied.push(dest);
    }
  }

  const env: Record<string, string> = { ...(opts.env ?? {}) };
  const keys = opts.homeEnvKeys ?? ["HOME"];
  for (const k of keys) env[k] = homePath;

  if (opts.auth.apiKeyEnv && (opts.auth.auth === "api_key" || opts.auth.auth === "both")) {
    const fromEnv = opts.env?.[opts.auth.apiKeyEnv] ?? process.env[opts.auth.apiKeyEnv];
    if (fromEnv) env[opts.auth.apiKeyEnv] = fromEnv;
  }

  return { path: homePath, env, copiedCredentials: copied };
}

/** Test helper: empty temp home that is deleted by the caller. */
export function tempControlledHome(prefix = "anyagent-home-"): string {
  return mkdtempSync(join(homedir(), prefix));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
