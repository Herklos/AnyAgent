/**
 * T-V1-WP3-02 wiring, T-V1-WP3-08 restart, T-V1-WP3-09/10 reaction delivery.
 */
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { decodeApprovalMessageRef } from "@anyagent/core";
import type { DecisionUpdateInput } from "@anyagent/workflows";
import { describe, expect, it } from "vitest";
import { type DecisionClient, startApprovalWatcher } from "../src/approvals.js";
import { waitFor } from "./support/wait.js";

const OWNER = "owner-1";
const STRANGER = "stranger";

class FakeDecision implements DecisionClient {
  readonly sent: DecisionUpdateInput[] = [];
  async deliverDecision(
    _target: { spaceId: string; agentId: string },
    input: DecisionUpdateInput,
  ): Promise<void> {
    this.sent.push(input);
  }
}

describe("gateway approvals watcher", () => {
  it("T-V1-WP3-08 restart: reaction while down is applied on catchUp", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, {
      handle: "chief",
      harness: "fake",
      mode: "ask",
    });
    const obj = await backend.objects.create("aa_approval", {
      name: "a1",
      fields: {
        aa_request_id: "r1",
        aa_requester: agent.agentId,
        aa_action: "edit x",
        aa_risk: "medium",
        aa_status: "pending",
        aa_message: "",
        aa_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const msg = await backend.chat.post(agent.chatId, {
      text: "⏳ Approval needed",
    });
    await backend.objects.update(obj.id, {
      aa_message: `${agent.chatId}/${msg.id}`,
    });
    await backend.reactAs(agent.chatId, msg.id, OWNER, "✅", true);

    const decision = new FakeDecision();
    const watcher = startApprovalWatcher({
      orgId: "org",
      spaceId: "space",
      backend,
      decision,
      ownerIds: [OWNER],
      agentAccounts: [backend.me],
    });
    // Background start also catchUp's; wait for the single decision.
    await waitFor(() => decision.sent.length >= 1, 5_000);
    expect(decision.sent).toHaveLength(1);
    expect(decision.sent[0]).toMatchObject({
      requestId: "r1",
      approved: true,
      decidedBy: OWNER,
    });
    await watcher.catchUp();
    expect(decision.sent).toHaveLength(1);
    await watcher.stop();
  });

  it("T-V1-WP3-09 double reaction produces one decision", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: [OWNER, "owner-2"], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, { handle: "chief", harness: "fake", mode: "ask" });
    const msg = await backend.chat.post(agent.chatId, { text: "⏳" });
    await backend.objects.create("aa_approval", {
      name: "a",
      fields: {
        aa_request_id: "r2",
        aa_requester: agent.agentId,
        aa_action: "x",
        aa_risk: "low",
        aa_status: "pending",
        aa_message: `${agent.chatId}/${msg.id}`,
        aa_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await backend.reactAs(agent.chatId, msg.id, OWNER, "✅", true);
    await backend.reactAs(agent.chatId, msg.id, "owner-2", "✅", true);

    const decision = new FakeDecision();
    const watcher = startApprovalWatcher({
      orgId: "org",
      spaceId: "space",
      backend,
      decision,
      ownerIds: [OWNER, "owner-2"],
      agentAccounts: [backend.me],
    });
    await waitFor(() => decision.sent.length >= 1, 5_000);
    const full = await backend.chat.get(agent.chatId, msg.id);
    await watcher.handleChatMessage(full!);
    await watcher.handleChatMessage(full!);
    expect(decision.sent).toHaveLength(1);
    expect(decision.sent[0]).toMatchObject({ requestId: "r2", approved: true });
    await watcher.stop();
  });

  it("T-V1-WP3-10 non-approver ✅ does nothing", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, { handle: "chief", harness: "fake", mode: "ask" });
    const msg = await backend.chat.post(agent.chatId, { text: "⏳" });
    await backend.objects.create("aa_approval", {
      name: "a",
      fields: {
        aa_request_id: "r3",
        aa_requester: agent.agentId,
        aa_action: "x",
        aa_risk: "low",
        aa_status: "pending",
        aa_message: `${agent.chatId}/${msg.id}`,
        aa_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await backend.reactAs(agent.chatId, msg.id, STRANGER, "✅", true);
    const decision = new FakeDecision();
    const watcher = startApprovalWatcher({
      orgId: "org",
      spaceId: "space",
      backend,
      decision,
      ownerIds: [OWNER],
      agentAccounts: [backend.me],
    });
    await watcher.handleChatMessage((await backend.chat.get(agent.chatId, msg.id))!);
    expect(decision.sent).toHaveLength(0);
    await watcher.stop();
  });

  it("decodes message refs for pending index", () => {
    expect(decodeApprovalMessageRef("c/m")).toEqual({ chatId: "c", messageId: "m" });
  });
});
