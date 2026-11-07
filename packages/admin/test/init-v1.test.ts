import { MemoryBackend } from "@anyagent/backend";
import { SCHEMA_VERSION, V0_SCHEMA } from "@anyagent/core";
import { describe, expect, it } from "vitest";
import { initOrg } from "../src/index.js";

describe("T-V1-WP3-11 init upgrade to 0.2.0", () => {
  it("upgrades a v0 space idempotently and sets approvers", async () => {
    const b = new MemoryBackend();
    // Simulate a v0 space: settings at 0.1.0 without aa_approvers / aa_approval type.
    await b.ensureSchema([
      {
        key: "aa_settings",
        label: "Settings",
        fields: [{ key: "aa_schema_version", label: "Schema version", format: "text" }],
      },
      {
        key: "aa_agent",
        label: "Agent",
        fields: [{ key: "aa_handle", label: "Handle", format: "text" }],
      },
    ]);
    await b.objects.create("aa_settings", {
      name: "settings",
      fields: { aa_schema_version: "0.1.0" },
    });
    // Keep an existing agent object untouched.
    const agent = await b.objects.create("aa_agent", {
      name: "keep-me",
      fields: { aa_handle: "keep-me" },
    });

    const r1 = await initOrg(b, {
      ownerIds: ["owner-1"],
      agentAccounts: [b.me],
    });
    expect(r1.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r1.approvers).toEqual(["owner-1"]);
    expect(r1.schema === "upgraded" || r1.settings === "updated").toBe(true);

    const r2 = await initOrg(b, {
      ownerIds: ["owner-1"],
      agentAccounts: [b.me],
    });
    expect(r2.message).toBe("nothing to do");

    const settings = await b.org.list("aa_settings");
    expect(settings[0]?.fields.aa_schema_version).toBe("0.2.0");
    expect(settings[0]?.fields.aa_approvers).toBe("owner-1");

    const still = await b.org.get(agent.id);
    expect(still?.fields.aa_handle).toBe("keep-me");

    // Schema includes aa_approval now.
    await b.ensureSchema(V0_SCHEMA);
    const created = await b.objects.create("aa_approval", {
      name: "probe",
      fields: { aa_request_id: "x", aa_status: "pending" },
    });
    expect(created.type).toBe("aa_approval");
  });

  it("refuses newer schema", async () => {
    const b = new MemoryBackend();
    await initOrg(b, { ownerIds: ["o"], agentAccounts: [b.me] });
    const settings = await b.org.list("aa_settings");
    await b.objects.update(settings[0]!.id, { aa_schema_version: "9.0.0" });
    await expect(initOrg(b)).rejects.toThrow(/newer/);
  });
});
