import type { Backend } from "@anyagent/backend";

export interface WriteScheduleProjectionDeps {
  backendForOrg: (orgId: string) => Backend;
}

export function createWriteScheduleProjection(deps: WriteScheduleProjectionDeps) {
  return async function writeScheduleProjection(input: {
    orgId: string;
    spaceId: string;
    scheduleObjectId: string;
    nextRunIso?: string;
    lastRunIso?: string;
  }): Promise<void> {
    const backend = deps.backendForOrg(input.orgId);
    const patch: Record<string, string> = {};
    if (input.nextRunIso) patch.aa_next_run = input.nextRunIso;
    if (input.lastRunIso) patch.aa_last_run = input.lastRunIso;
    if (Object.keys(patch).length === 0) return;
    await backend.objects.update(input.scheduleObjectId, patch);
  };
}
