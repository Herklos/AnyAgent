import type { Backend } from "@anyagent/backend";
import { parseAgentSpec } from "@anyagent/core";
import type { ResolvedSchedule } from "@anyagent/workflows";

export interface ResolveScheduleDeps {
  backendForOrg: (orgId: string) => Backend;
  ownerIdsForOrg: (orgId: string) => string[];
}

export function createResolveSchedule(deps: ResolveScheduleDeps) {
  return async function resolveSchedule(input: {
    orgId: string;
    spaceId: string;
    scheduleId: string;
    agentId: string;
  }): Promise<ResolvedSchedule> {
    const backend = deps.backendForOrg(input.orgId);
    const sched = await backend.org.get(input.scheduleId);
    if (!sched || sched.type !== "aa_schedule") {
      return { ok: false, reason: `schedule ${input.scheduleId} not found` };
    }
    const ownerId = String(sched.fields.aa_owner ?? "");
    if (ownerId && ownerId !== input.agentId) {
      return { ok: false, reason: "schedule owner mismatch" };
    }
    const agent = await backend.org.get(input.agentId);
    if (!agent) return { ok: false, reason: "agent not found" };
    const parsed = parseAgentSpec(agent, agent.body);
    if (!parsed.ok) return { ok: false, reason: "invalid agent spec" };

    const owners = deps.ownerIdsForOrg(input.orgId);
    const ownerAuthorId = owners[0] ?? "schedule-owner";

    return {
      ok: true,
      scheduleObjectId: sched.id,
      name: sched.name || sched.id,
      prompt: sched.body ?? "",
      chatId: parsed.spec.chatId,
      ownerAuthorId,
      agentLifecycle: parsed.spec.lifecycle,
    };
  };
}
