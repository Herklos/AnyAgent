import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeReadOnlyConfig, ConfigGuardError, prepareControlledHome } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T-WP4-06 controlled home", () => {
  it("copies only listed credentials at 0600 and never writes the real home", () => {
    const real = mkdtempSync(join(tmpdir(), "real-home-"));
    const state = mkdtempSync(join(tmpdir(), "state-"));
    dirs.push(real, state);
    mkdirSync(join(real, ".codex"), { recursive: true });
    writeFileSync(join(real, ".codex", "auth.json"), '{"token":"x"}');
    writeFileSync(join(real, "other.txt"), "nope");
    const before = readFileSync(join(real, ".codex", "auth.json"), "utf8");

    const home = prepareControlledHome({
      stateDir: state,
      spaceId: "sp",
      agentId: "ag",
      realHome: real,
      auth: { auth: "login", credentialPaths: [".codex/auth.json"] },
    });

    expect(existsSync(join(home.path, ".codex", "auth.json"))).toBe(true);
    expect(existsSync(join(home.path, "other.txt"))).toBe(false);
    expect(statSync(join(home.path, ".codex", "auth.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(real, ".codex", "auth.json"), "utf8")).toBe(before);
    expect(home.env.HOME).toBe(home.path);
  });
});

describe("T-WP4-07 configuration guard", () => {
  it("detects unsafe settings and names file+setting; clean config passes", () => {
    const home = mkdtempSync(join(tmpdir(), "guard-"));
    dirs.push(home);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(*)"], defaultMode: "bypassPermissions" } }),
    );
    expect(() => assertSafeReadOnlyConfig({ harnessId: "claude-code", home })).toThrow(
      ConfigGuardError,
    );

    const clean = mkdtempSync(join(tmpdir(), "guard-clean-"));
    dirs.push(clean);
    mkdirSync(join(clean, ".claude"), { recursive: true });
    writeFileSync(
      join(clean, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: [] } }),
    );
    expect(() => assertSafeReadOnlyConfig({ harnessId: "claude-code", home: clean })).not.toThrow();

    const codexHome = mkdtempSync(join(tmpdir(), "guard-codex-"));
    dirs.push(codexHome);
    mkdirSync(join(codexHome, ".codex"), { recursive: true });
    writeFileSync(
      join(codexHome, ".codex", "config.toml"),
      'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n',
    );
    try {
      assertSafeReadOnlyConfig({ harnessId: "codex", home: codexHome });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigGuardError);
      expect(String(e)).toMatch(/approval_policy|sandbox_mode/);
    }
  });
});
