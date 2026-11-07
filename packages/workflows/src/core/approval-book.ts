/**
 * Pure approval ledger (no Temporal, no clock). Expiry is driven by the workflow timer.
 */

export type ApprovalRisk = "low" | "medium" | "high" | "unknown";

export interface ApprovalRequestInput {
  requestId: string;
  toolName: string;
  summary: string;
  risk: ApprovalRisk;
  /** Hint only — timer lives in the workflow. */
  expiresInMs: number;
}

export interface ApprovalEntry {
  requestId: string;
  toolName: string;
  summary: string;
  risk: ApprovalRisk;
  expiresInMs: number;
  status: "pending" | "approved" | "denied" | "expired";
  decidedBy?: string;
  reason?: string;
}

export type DecideResult =
  | { outcome: "decided"; entry: ApprovalEntry }
  | { outcome: "already_decided"; entry: ApprovalEntry }
  | { outcome: "unknown" }
  | { outcome: "ignored_expired"; entry: ApprovalEntry };

export class ApprovalBook {
  private readonly byId = new Map<string, ApprovalEntry>();
  private readonly order: string[] = [];

  request(input: ApprovalRequestInput): ApprovalEntry {
    const existing = this.byId.get(input.requestId);
    if (existing) return existing;
    const entry: ApprovalEntry = {
      requestId: input.requestId,
      toolName: input.toolName,
      summary: input.summary,
      risk: input.risk,
      expiresInMs: input.expiresInMs,
      status: "pending",
    };
    this.byId.set(input.requestId, entry);
    this.order.push(input.requestId);
    return entry;
  }

  decide(
    requestId: string,
    decision: { approved: boolean; decidedBy: string; reason?: string },
  ): DecideResult {
    const entry = this.byId.get(requestId);
    if (!entry) return { outcome: "unknown" };
    if (entry.status === "expired") return { outcome: "ignored_expired", entry };
    if (entry.status !== "pending") return { outcome: "already_decided", entry };
    entry.status = decision.approved ? "approved" : "denied";
    entry.decidedBy = decision.decidedBy;
    if (decision.reason !== undefined) entry.reason = decision.reason;
    return { outcome: "decided", entry };
  }

  expire(requestId: string): ApprovalEntry | undefined {
    const entry = this.byId.get(requestId);
    if (!entry) return undefined;
    if (entry.status !== "pending") return entry;
    entry.status = "expired";
    entry.reason = "expired";
    return entry;
  }

  get(requestId: string): ApprovalEntry | undefined {
    return this.byId.get(requestId);
  }

  pending(): ApprovalEntry[] {
    return this.order.map((id) => this.byId.get(id)!).filter((e) => e.status === "pending");
  }

  hasPending(): boolean {
    return this.pending().length > 0;
  }
}
