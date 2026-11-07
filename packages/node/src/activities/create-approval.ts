import type { Backend } from "@anyagent/backend";
import {
  type ApprovalRiskLevel,
  encodeApprovalMessageRef,
  formatApprovalChatNotice,
  type PermissionKind,
  riskForKind,
  summariseAction,
} from "@anyagent/core";

export interface CreateApprovalInput {
  orgId: string;
  spaceId: string;
  agentId: string;
  requestId: string;
  toolName: string;
  summary: string;
  risk: string;
  expiresInMs: number;
  kind?: string;
  title?: string;
  rawInput?: unknown;
}

export interface CreateApprovalResult {
  approvalObjectId: string;
  messageId: string;
}

export interface CreateApprovalDeps {
  backendForOrg: (orgId: string) => Backend;
}

function asRisk(r: string): ApprovalRiskLevel {
  if (r === "low" || r === "medium" || r === "high") return r;
  return "medium";
}

/**
 * Idempotent: same aa_request_id → same object and message.
 */
export function createCreateApproval(deps: CreateApprovalDeps) {
  return async function createApproval(input: CreateApprovalInput): Promise<CreateApprovalResult> {
    const backend = deps.backendForOrg(input.orgId);
    const existing = await backend.org.list("aa_approval", { aa_request_id: input.requestId });
    if (existing[0]) {
      const full = (await backend.org.get(existing[0].id)) ?? existing[0];
      const ref = String(full.fields.aa_message ?? "");
      const messageId = ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : "";
      return { approvalObjectId: full.id, messageId };
    }

    const agent = await backend.org.get(input.agentId);
    if (!agent) throw new Error(`agent ${input.agentId} not found`);
    const chatId = String(agent.fields.aa_chat ?? "");
    const handle = String(agent.fields.aa_handle ?? "agent");
    if (!chatId) throw new Error(`agent ${input.agentId} has no aa_chat`);

    const kind = input.kind as PermissionKind | undefined;
    const summary =
      input.summary ||
      summariseAction({
        toolName: input.toolName,
        ...(kind ? { kind } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.rawInput !== undefined ? { rawInput: input.rawInput } : {}),
      });
    const risk = asRisk(input.risk || (kind ? riskForKind(kind) : "medium"));
    const expiresAt = new Date(Date.now() + Math.max(1, input.expiresInMs)).toISOString();

    const obj = await backend.objects.create("aa_approval", {
      name: `approval:${input.requestId}`,
      fields: {
        aa_request_id: input.requestId,
        aa_requester: input.agentId,
        aa_action: summary,
        aa_risk: risk,
        aa_status: "pending",
        aa_message: "",
        aa_expires_at: expiresAt,
        aa_decided_by: "",
        aa_decided_at: "",
      },
    });

    const text = formatApprovalChatNotice({
      handle,
      summary,
      risk,
      expiresAtIso: expiresAt,
      objectId: obj.id,
    });
    const msg = await backend.chat.post(chatId, { text });
    const ref = encodeApprovalMessageRef(chatId, msg.id);
    await backend.objects.update(obj.id, { aa_message: ref });

    return { approvalObjectId: obj.id, messageId: msg.id };
  };
}
