import { describe, expect, it } from "vitest";
import {
  desiredSchedule,
  diffSchedules,
  isValidIanaZone,
  nextRunTimes,
  parseScheduleCron,
  temporalScheduleId,
} from "../src/schedule.js";

describe("T-V1-WP4-01 cron and zone parsing", () => {
  it("accepts valid 5-field crons and IANA zones", () => {
    expect(parseScheduleCron("0 9 * * 1-5", "Europe/Paris").ok).toBe(true);
    expect(parseScheduleCron("*/15 * * * *", "UTC").ok).toBe(true);
    expect(isValidIanaZone("America/New_York")).toBe(true);
  });

  it("rejects six-field, bad ranges, unknown zone", () => {
    expect(parseScheduleCron("0 0 9 * * *", "UTC").ok).toBe(false);
    expect(parseScheduleCron("99 9 * * *", "UTC").ok).toBe(false);
    expect(parseScheduleCron("0 9 * * *", "Not/AZone").ok).toBe(false);
  });

  it("next times across DST for Europe/Paris and America/New_York", () => {
    // Spring forward 2026-03-29 in Paris; fall back 2026-11-01 in New York.
    const paris = nextRunTimes(
      "0 2 * * *",
      "Europe/Paris",
      3,
      new Date("2026-03-28T12:00:00.000Z"),
    );
    expect(paris.length).toBe(3);
    // All distinct ISO strings
    expect(new Set(paris).size).toBe(3);

    const nyc = nextRunTimes(
      "0 2 * * *",
      "America/New_York",
      3,
      new Date("2026-10-31T12:00:00.000Z"),
    );
    expect(nyc.length).toBe(3);
    expect(new Set(nyc).size).toBe(3);
  });
});

describe("T-V1-WP4-02 desiredSchedule", () => {
  const base = {
    objectId: "s1",
    name: "morning",
    ownerId: "agent1",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: true,
    body: "say hi",
  };

  it("enabled + live owner → running", () => {
    const d = desiredSchedule(base, "space", { agentId: "agent1", lifecycle: "live" });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.paused).toBe(false);
      expect(d.scheduleId).toBe(temporalScheduleId("space", "s1"));
    }
  });

  it("disabled → paused", () => {
    const d = desiredSchedule({ ...base, enabled: false }, "space", {
      agentId: "agent1",
      lifecycle: "live",
    });
    expect(d.ok && d.paused).toBe(true);
  });

  it("owner paused or missing → paused", () => {
    expect(
      desiredSchedule(base, "space", { agentId: "agent1", lifecycle: "paused" }).ok &&
        (
          desiredSchedule(base, "space", { agentId: "agent1", lifecycle: "paused" }) as {
            paused: boolean;
          }
        ).paused,
    ).toBe(true);
    const missing = desiredSchedule(base, "space", undefined);
    expect(missing.ok && missing.paused).toBe(true);
  });

  it("invalid cron → rejected", () => {
    const d = desiredSchedule({ ...base, cron: "bad" }, "space", {
      agentId: "agent1",
      lifecycle: "live",
    });
    expect(d.ok).toBe(false);
  });
});

describe("T-V1-WP4-03 diffSchedules", () => {
  const desired = {
    ok: true as const,
    scheduleId: "schedule:space:s1",
    cron: "0 9 * * *",
    timezone: "UTC",
    paused: false,
    agentId: "a1",
    objectId: "s1",
    name: "morning",
  };

  it("create, pause, unpause, spec change, delete, noop", () => {
    expect(diffSchedules([desired], [])).toEqual([{ op: "create", desired }]);

    expect(
      diffSchedules(
        [desired],
        [{ scheduleId: desired.scheduleId, cron: desired.cron, timezone: "UTC", paused: false }],
      ),
    ).toEqual([{ op: "noop", scheduleId: desired.scheduleId }]);

    const pauseOps = diffSchedules(
      [{ ...desired, paused: true }],
      [{ scheduleId: desired.scheduleId, cron: desired.cron, timezone: "UTC", paused: false }],
    );
    expect(pauseOps[0]?.op).toBe("update");
    if (pauseOps[0]?.op === "update") expect(pauseOps[0].pause).toBe(true);

    const unpauseOps = diffSchedules(
      [desired],
      [{ scheduleId: desired.scheduleId, cron: desired.cron, timezone: "UTC", paused: true }],
    );
    expect(unpauseOps[0]?.op).toBe("update");
    if (unpauseOps[0]?.op === "update") expect(unpauseOps[0].unpause).toBe(true);

    const specOps = diffSchedules(
      [{ ...desired, cron: "0 10 * * *" }],
      [{ scheduleId: desired.scheduleId, cron: "0 9 * * *", timezone: "UTC", paused: false }],
    );
    expect(specOps[0]?.op).toBe("update");
    if (specOps[0]?.op === "update") expect(specOps[0].specChanged).toBe(true);

    expect(
      diffSchedules(
        [],
        [{ scheduleId: "schedule:space:gone", cron: "0 9 * * *", timezone: "UTC", paused: false }],
      ),
    ).toEqual([{ op: "delete", scheduleId: "schedule:space:gone" }]);

    // Twice: equal → noop both times
    const existing = [
      { scheduleId: desired.scheduleId, cron: desired.cron, timezone: "UTC", paused: false },
    ];
    expect(diffSchedules([desired], existing).every((o) => o.op === "noop")).toBe(true);
    expect(diffSchedules([desired], existing).every((o) => o.op === "noop")).toBe(true);
  });
});
