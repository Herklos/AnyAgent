import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("T-WP7-01 argument parsing", () => {
  it("unknown command → exit 2", async () => {
    const r = await runCli(["node", "anybot", "nope"]);
    expect(r.code).toBe(2);
    expect(r.error).toMatch(/unknown command/);
  });

  it("agent create missing harness → exit 2", async () => {
    const r = await runCli(["node", "anybot", "agent", "create", "chief"]);
    expect(r.code).toBe(2);
    expect(r.error).toMatch(/harness/);
  });

  it("unknown flag → exit 2", async () => {
    const r = await runCli(["node", "anybot", "init", "--bogus"]);
    expect(r.code).toBe(2);
  });

  it("version prints", async () => {
    const r = await runCli(["node", "anybot", "version"]);
    expect(r.code).toBe(0);
  });
});
