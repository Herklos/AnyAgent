/**
 * T-V1-WP4-09 projection written by node; T-V1-WP4-11 schema aa_schedule.
 */
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { SCHEMA_VERSION, V0_SCHEMA } from "@anyagent/core";
import { describe, expect, it, vi } from "vitest";
import { createResolveSchedule } from "../src/activities/resolve-schedule.js";
import { createWriteScheduleProjection } from "../src/activities/write-schedule-projection.js";

const OWNER = "owner-1";

describe("schedule activities", () => {
  it("T-V1-WP4-11 aa_schedule ensured by init schema 0.2.0", async () => {
    const b = new MemoryBackend();
    await initOrg(b, { ownerIds: [OWNER], agentAccounts: [b.me] });
    const settings = await b.org.list("aa_settings");
    expect(settings[0]?.fields.aa_schema_version).toBe(SCHEMA_VERSION);
    await b.ensureSchema(V0_SCHEMA);
    const s = await b.objects.create("aa_schedule", {
      name: "t",
      fields: { aa_cron: "0 9 * * *", aa_timezone: "UTC", aa_enabled: true },
      body: "hi",
    });
    expect(s.type).toBe("aa_schedule");
  });

  it("T-V1-WP4-09 writeScheduleProjection updates fields; resolveSchedule returns prompt", async () => {
    const backend = new MemoryBackend();
    const updateSpy = vi.spyOn(backend.objects, "update");
    await initOrg(backend, { ownerIds: [OWNER], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, { handle: "chief", harness: "fake" });
    const sched = await backend.objects.create("aa_schedule", {
      name: "morning",
      fields: {
        aa_owner: agent.agentId,
        aa_cron: "0 9 * * *",
        aa_timezone: "UTC",
        aa_enabled: true,
      },
      body: "say hello",
    });

    const write = createWriteScheduleProjection({ backendForOrg: () => backend });
    await write({
      orgId: "org",
      spaceId: "space",
      scheduleObjectId: sched.id,
      nextRunIso: "2026-11-08T09:00:00.000Z",
      lastRunIso: "2026-11-07T09:00:00.000Z",
    });
    const got = await backend.org.get(sched.id);
    expect(got?.fields.aa_next_run).toBe("2026-11-08T09:00:00.000Z");
    expect(got?.fields.aa_last_run).toBe("2026-11-07T09:00:00.000Z");
    expect(updateSpy).toHaveBeenCalled();

    const resolve = createResolveSchedule({
      backendForOrg: () => backend,
      ownerIdsForOrg: () => [OWNER],
    });
    const r = await resolve({
      orgId: "org",
      spaceId: "space",
      scheduleId: sched.id,
      agentId: agent.agentId,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prompt).toBe("say hello");
      expect(r.chatId).toBe(agent.chatId);
      expect(r.ownerAuthorId).toBe(OWNER);
    }
  });
});
