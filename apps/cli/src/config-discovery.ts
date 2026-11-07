import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { type AnyagentConfig, loadConfig } from "@anyagent/core";

/**
 * Config discovery order (WP7):
 * `--config` → `ANYBOT_CONFIG` → `./anybot.config.yaml` → `~/.config/anybot/config.yaml`
 * Also accepts the legacy `./anyagent.config.yaml` after the preferred names.
 */
export function discoverConfigPath(cliFlag?: string): string {
  if (cliFlag) {
    const p = isAbsolute(cliFlag) ? cliFlag : resolve(process.cwd(), cliFlag);
    if (!existsSync(p)) throw new Error(`config not found: ${p}`);
    return p;
  }
  const env = process.env.ANYBOT_CONFIG;
  if (env) {
    const p = isAbsolute(env) ? env : resolve(process.cwd(), env);
    if (!existsSync(p)) throw new Error(`ANYBOT_CONFIG not found: ${p}`);
    return p;
  }
  const candidates = [
    resolve(process.cwd(), "anybot.config.yaml"),
    resolve(homedir(), ".config/anybot/config.yaml"),
    resolve(process.cwd(), "anyagent.config.yaml"),
    resolve(homedir(), ".config/anyagent/config.yaml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "no config found; pass --config, set ANYBOT_CONFIG, or create ./anybot.config.yaml",
  );
}

export function loadDiscoveredConfig(cliFlag?: string): { path: string; config: AnyagentConfig } {
  const path = discoverConfigPath(cliFlag);
  return { path, config: loadConfig(path) };
}
