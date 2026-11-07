/**
 * T-V1-WP4-03 reconciler against a fake Temporal schedule port;
 * T-V1-WP4-09/10 projection + invalid neighbour.
 */
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { describe, expect, it } from "vitest";
import {
  type ExistingTemporalSchedule,
  startScheduleReconciler,
  type TemporalSchedulePort,
} from "../src/schedules.js";

class FakeSchedulePort implements TemporalSchedulePort {
  readonly store = new Map<string, ExistingTemporalSchedule & { args?: Record<string, unknown> }>();
  creates = 0;
  updates = 0;
  deletes = 0;

  async list(prefix: string) {
    return [...this.store.values()].filter((s) => s.scheduleId.startsWith(prefix));
  }
  async create(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }) {
    this.creates += 1;
    this.store.set(input.scheduleId, {
      scheduleId: input.scheduleId,
      cron: input.cron,
      timezone: input.timezone,
      paused: input.paused,
      args: input.args,
    });
  }
  async update(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }) {
    this.updates += 1;
    this.store.set(input.scheduleId, {
      scheduleId: input.scheduleId,
      cron: input.cron,
      timezone: input.timezone,
      paused: input.paused,
      args: input.args,
    });
  }
  async delete(id: string) {
    this.deletes += 1;
    this.store.delete(id);
  }
  async pause(id: string) {
    const s = this.store.get(id);
    if (s) s.paused = true;
  }
  async unpause(id: string) {
    const s = this.store.get(id);
    if (s) s.paused = false;
  }
}

describe("schedule reconciler", () => {
  it("T-V1-WP4-03 create / pause / delete / noop twice", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, {
      handle: "chief",
      harness: "fake",
      mode: "full",
    });
    const sched = await backend.objects.create("aa_schedule", {
      name: "morning",
      fields: {
        aa_owner: agent.agentId,
        aa_cron: "0 9 * * *",
        aa_timezone: "UTC",
        aa_enabled: true,
      },
      body: "post the weather",
    });

    const port = new FakeSchedulePort();
    // sleep never resolves → background loop parks after first pass; tests drive reconcile().
    const park = new Promise<void>(() => {});
    const reconciler = startScheduleReconciler({
      orgId: "org",
      spaceId: "space",
      backend,
      schedules: port,
      nodeQueue: "node:space:n1",
      intervalMs: 60_000,
      sleep: async () => park,
    });

    // Wait for the background first pass (serialized with our call via the reconcile gate).
    await new Promise((r) => setTimeout(r, 50));
    const r1 = await reconciler.reconcile();
    // First pass may already have created; second call is a noop (applied 0) or first (1).
    expect(port.creates).toBe(1);
    expect(r1.applied).toBeLessThanOrEqual(1);
    const id = `schedule:space:${sched.id}`;
    expect(port.store.get(id)?.paused).toBe(false);

    const r2 = await reconciler.reconcile();
    expect(r2.applied).toBe(0);

    await backend.objects.update(sched.id, { aa_enabled: false });
    const r3 = await reconciler.reconcile();
    expect(r3.applied).toBe(1);
    expect(port.store.get(id)?.paused).toBe(true);

    backend.deleteObject(sched.id);
    const r4 = await reconciler.reconcile();
    expect(r4.applied).toBe(1);
    expect(port.deletes).toBe(1);

    await reconciler.stop();
  });

  it("T-V1-WP4-10 invalid next to valid: valid still reconciled; invalid listed", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend, { ownerIds: ["owner-1"], agentAccounts: [backend.me] });
    const agent = await createAgent(backend, { handle: "chief", harness: "fake" });
    await backend.objects.create("aa_schedule", {
      name: "good",
      fields: {
        aa_owner: agent.agentId,
        aa_cron: "0 9 * * *",
        aa_timezone: "UTC",
        aa_enabled: true,
      },
      body: "ok",
    });
    await backend.objects.create("aa_schedule", {
      name: "bad",
      fields: {
        aa_owner: agent.agentId,
        aa_cron: "not a cron",
        aa_timezone: "UTC",
        aa_enabled: true,
      },
      body: "nope",
    });
    const port = new FakeSchedulePort();
    const park = new Promise<void>(() => {});
    const reconciler = startScheduleReconciler({
      orgId: "org",
      spaceId: "space",
      backend,
      schedules: port,
      nodeQueue: "nq",
      intervalMs: 60_000,
      sleep: async () => park,
    });
    await new Promise((r) => setTimeout(r, 50));
    const r = await reconciler.reconcile();
    expect(port.creates).toBe(1);
    // rejected may come from this call or the background first pass; re-run to collect.
    const rejected = r.rejected.length > 0 ? r.rejected : (await reconciler.reconcile()).rejected;
    expect(rejected.length).toBe(1);
    expect(rejected[0]).toMatch(/cron|field/i);
    await reconciler.stop();
  });
});
