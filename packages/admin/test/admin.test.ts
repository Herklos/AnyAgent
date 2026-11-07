import { MemoryBackend, SCHEMA as SPIKE_SCHEMA } from "@anyagent/backend";
import { V0_SCHEMA } from "@anyagent/core";
import { describe, expect, it } from "vitest";
import { createAgent, initOrg, listAgents } from "../src/index.js";

describe("T-WP2-04 initOrg", () => {
  it("second run reports no changes; newer schema refused", async () => {
    const b = new MemoryBackend();
    await b.ensureSchema([...SPIKE_SCHEMA, ...V0_SCHEMA]);
    const r1 = await initOrg(b, { ownerIds: ["owner"], agentAccounts: [b.me] });
    expect(r1.message).toMatch(/created|nothing|settings/);
    const r2 = await initOrg(b, { ownerIds: ["owner"], agentAccounts: [b.me] });
    expect(r2.message).toBe("nothing to do");

    const settings = await b.org.list("aa_settings");
    if (settings[0]) {
      await b.objects.update(settings[0].id, { aa_schema_version: "9.0.0" });
    } else {
      await b.objects.create("aa_settings", {
        name: "s",
        fields: { aa_schema_version: "9.0.0" },
      });
    }
    await expect(initOrg(b, { ownerIds: ["owner"], agentAccounts: [b.me] })).rejects.toThrow(
      /newer/,
    );
  });
});

describe("T-WP2-05 createAgent", () => {
  it("object and chat exist; duplicate and invalid refused", async () => {
    const b = new MemoryBackend();
    await b.ensureSchema(V0_SCHEMA);
    await initOrg(b, { ownerIds: ["owner"], agentAccounts: [b.me] });
    const { agentId, chatId } = await createAgent(b, {
      handle: "chief",
      harness: "claude-code",
    });
    const got = await b.org.get(agentId);
    expect(got?.fields.aa_chat).toBe(chatId);
    await expect(createAgent(b, { handle: "chief", harness: "codex" })).rejects.toThrow(
      /duplicate/,
    );
    await expect(createAgent(b, { handle: "BAD", harness: "codex" })).rejects.toThrow(/invalid/);
  });
});

describe("T-WP2-06 listAgents", () => {
  it("returns valid and broken without throwing", async () => {
    const b = new MemoryBackend();
    await b.ensureSchema(V0_SCHEMA);
    await initOrg(b, { ownerIds: ["owner"], agentAccounts: [b.me] });
    await createAgent(b, { handle: "ok-bot", harness: "claude-code" });
    await b.objects.create("aa_agent", {
      name: "broken",
      fields: { aa_handle: "x" },
    });
    const list = await listAgents(b);
    expect(list.some((a) => a.spec?.handle === "ok-bot")).toBe(true);
    expect(list.some((a) => a.error)).toBe(true);
  });
});
