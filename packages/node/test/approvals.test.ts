/**
 * T-V1-WP3-03 createApproval idempotent; recordDecision writes status + notice.
 */
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { describe, expect, it } from "vitest";
import { createCreateApproval } from "../src/activities/create-approval.js";
import { createRecordDecision } from "../src/activities/record-decision.js";

const OWNER = "owner-1";

describe("T-V1-WP3-03 createApproval / recordDecision", () => {
  it("two calls with one requestId create one object and one message", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, {
      handle: "chief",
      harness: "fake",
      mode: "ask",
      allowedAuthors: [OWNER],
    });

    const createApproval = createCreateApproval({ backendForOrg: () => backend });
    const input = {
      orgId: "org",
      spaceId: "space",
      agentId: agent.agentId,
      requestId: "req-1",
      toolName: "Write",
      summary: "edit out.txt",
      risk: "medium",
      expiresInMs: 60_000,
      kind: "edit",
    };
    const a = await createApproval(input);
    const b = await createApproval(input);
    expect(a.approvalObjectId).toBe(b.approvalObjectId);
    expect(a.messageId).toBe(b.messageId);

    const rows = await backend.org.list("aa_approval", { aa_request_id: "req-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fields.aa_status).toBe("pending");

    const hist = await backend.chat.history(agent.chatId, { limit: 20 });
    const notices = hist.filter((m) => /Approval needed/i.test(m.text));
    expect(notices).toHaveLength(1);
  });

  it("recordDecision sets status and posts confirmation", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, {
      handle: "chief",
      harness: "fake",
      mode: "ask",
    });
    const createApproval = createCreateApproval({ backendForOrg: () => backend });
    const recordDecision = createRecordDecision({ backendForOrg: () => backend });
    await createApproval({
      orgId: "org",
      spaceId: "space",
      agentId: agent.agentId,
      requestId: "req-2",
      toolName: "Bash",
      summary: "run `ls`",
      risk: "high",
      expiresInMs: 60_000,
    });
    await recordDecision({
      orgId: "org",
      spaceId: "space",
      agentId: agent.agentId,
      requestId: "req-2",
      approved: true,
      decidedBy: OWNER,
    });
    const rows = await backend.org.list("aa_approval", { aa_request_id: "req-2" });
    expect(rows[0]?.fields.aa_status).toBe("approved");
    expect(rows[0]?.fields.aa_decided_by).toBe(OWNER);
    const hist = await backend.chat.history(agent.chatId, { limit: 20 });
    expect(hist.some((m) => /approved by owner-1/i.test(m.text))).toBe(true);

    // Second call is a no-op (already decided).
    await recordDecision({
      orgId: "org",
      spaceId: "space",
      agentId: agent.agentId,
      requestId: "req-2",
      approved: false,
      decidedBy: OWNER,
    });
    const again = await backend.org.list("aa_approval", { aa_request_id: "req-2" });
    expect(again[0]?.fields.aa_status).toBe("approved");
  });
});
