import type { Backend } from "@anyagent/backend";
import { decodeApprovalMessageRef, formatDecisionNotice } from "@anyagent/core";

export interface RecordDecisionInput {
  orgId: string;
  spaceId: string;
  agentId: string;
  requestId: string;
  approved: boolean;
  decidedBy: string;
  reason?: string;
  expired?: boolean;
}

export interface RecordDecisionDeps {
  backendForOrg: (orgId: string) => Backend;
}

/**
 * Sets aa_status / decided_* and posts a short confirmation reply once.
 */
export function createRecordDecision(deps: RecordDecisionDeps) {
  return async function recordDecision(input: RecordDecisionInput): Promise<void> {
    const backend = deps.backendForOrg(input.orgId);
    const rows = await backend.org.list("aa_approval", { aa_request_id: input.requestId });
    const row = rows[0];
    if (!row) return;

    const full = (await backend.org.get(row.id)) ?? row;
    const current = String(full.fields.aa_status ?? "");
    if (current !== "pending") return;

    const status = input.expired ? "expired" : input.approved ? "approved" : "denied";
    const decidedAt = new Date().toISOString();
    await backend.objects.update(full.id, {
      aa_status: status,
      aa_decided_by: input.decidedBy,
      aa_decided_at: decidedAt,
    });

    const ref = decodeApprovalMessageRef(String(full.fields.aa_message ?? ""));
    if (!ref) return;
    const notice = formatDecisionNotice(
      status === "expired" ? "expired" : input.approved ? "approved" : "denied",
      input.decidedBy,
    );
    await backend.chat.post(ref.chatId, { text: notice, replyTo: ref.messageId });
  };
}
