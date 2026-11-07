import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { describe, expect, it } from "vitest";
import { startAgentDiscovery } from "../src/agents.js";
import { waitFor } from "./support/wait.js";

describe("T-WP5-10 agent discovery", () => {
  it("new agent starts tracking; invalid spec stops; deleted agent stops", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend);
    const discovery = await startAgentDiscovery({
      backend,
      orgId: "org",
      spaceId: "space",
    });
    expect(discovery.agents.size).toBe(0);

    const created = await createAgent(backend, {
      handle: "alice",
      harness: "claude-code",
      allowedAuthors: ["owner-1"],
    });
    await waitFor(() => discovery.agents.has(created.agentId), 5_000);
    expect(discovery.agents.get(created.agentId)?.chatId).toBe(created.chatId);

    // Invalidate spec
    await backend.objects.update(created.agentId, { aa_handle: "BAD" });
    await waitFor(() => !discovery.agents.has(created.agentId), 5_000);

    const created2 = await createAgent(backend, {
      handle: "bob",
      harness: "codex",
    });
    await waitFor(() => discovery.agents.has(created2.agentId), 5_000);
    backend.deleteObject(created2.agentId);
    await waitFor(() => !discovery.agents.has(created2.agentId), 5_000);

    await discovery.stop();
  });
});
