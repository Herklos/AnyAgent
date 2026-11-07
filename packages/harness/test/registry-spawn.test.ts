import { describe, expect, it } from "vitest";
import { descriptorFor, spawnPlanFor, vibe } from "../src/index.js";

describe("T-WP4-05 registry spawn mapping", () => {
  it("maps codex read_only and full to sandbox flags", () => {
    const ro = spawnPlanFor("codex", "read_only", { cwd: "/w" });
    expect(ro.sandbox).toBe("read-only");
    expect(ro.args.join(" ")).toMatch(/approval_policy=untrusted/);
    expect(ro.args.join(" ")).toMatch(/sandbox_mode=read-only/);

    const full = spawnPlanFor("codex", "full", { cwd: "/w" });
    expect(full.sandbox).toBe("danger-full-access");
  });

  it("maps grok sandbox flag", () => {
    const ro = spawnPlanFor("grok", "read_only", { cwd: "/w" });
    expect(ro.args).toContain("--sandbox");
    expect(ro.args).toContain("read-only");
    const full = spawnPlanFor("grok", "full", { cwd: "/w" });
    expect(full.args).toContain("off");
  });

  it("claude-code uses ask mode name for host-gated read_only", () => {
    const ro = spawnPlanFor("claude-code", "read_only", { cwd: "/w" });
    expect(ro.agentFlag).toBe("default");
  });
});

describe("T-WP4-13b vibe flags and ask/auto refusal", () => {
  it("refuses ask/auto for headless vibe", () => {
    expect(vibe.permissionCallbacks).toBe(false);
    expect(() => spawnPlanFor("vibe", "ask", { cwd: "/w" })).toThrow(/permission callbacks/);
    expect(() => spawnPlanFor("vibe", "auto", { cwd: "/w" })).toThrow(/permission callbacks/);
  });

  it("builds vibe read_only and full args", () => {
    const ro = spawnPlanFor("vibe", "read_only", { cwd: "/w", env: { VIBE_HOME: "/tmp/vh" } });
    expect(ro.command).toBe("vibe");
    expect(ro.args).toContain("--agent");
    expect(ro.args).toContain("ask");
    expect(ro.args).not.toContain("--auto-approve");
    expect(ro.env?.VIBE_HOME).toBe("/tmp/vh");

    const full = spawnPlanFor("vibe", "full", { cwd: "/w", env: { VIBE_HOME: "/tmp/vh" } });
    expect(full.args).toContain("auto-approve");
    expect(full.args).toContain("--auto-approve");
  });

  it("auth descriptors report login/api_key support", () => {
    expect(descriptorFor("claude-code").auth.auth).toMatch(/login|both|api_key/);
    expect(descriptorFor("codex").auth.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(descriptorFor("vibe").auth).toMatchObject({
      auth: "api_key",
      apiKeyEnv: "MISTRAL_API_KEY",
    });
  });
});
