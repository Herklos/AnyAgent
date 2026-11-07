/**
 * Gateway schedule reconciler: Anytype aa_schedule ↔ Temporal Schedules (WP4).
 * Never writes to Anytype — projection is a node activity.
 */
import type { Backend } from "@anyagent/backend";
import {
  desiredSchedule,
  diffSchedules,
  type ExistingTemporalSchedule,
  parseAgentSpec,
  scheduleFieldsFromObject,
} from "@anyagent/core";
import { SCHEDULE_KICK_WORKFLOW, WORKFLOW_TASK_QUEUE } from "@anyagent/workflows";
import type { Client, ScheduleClient } from "@temporalio/client";
import { logGateway } from "./log.js";

export interface TemporalSchedulePort {
  list(prefix: string): Promise<ExistingTemporalSchedule[]>;
  create(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }): Promise<void>;
  update(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }): Promise<void>;
  delete(scheduleId: string): Promise<void>;
  pause(scheduleId: string): Promise<void>;
  unpause(scheduleId: string): Promise<void>;
}

export class RealTemporalSchedulePort implements TemporalSchedulePort {
  constructor(
    private readonly schedule: ScheduleClient,
    private readonly opts: {
      taskQueue?: string;
      catchupWindow?: string;
    } = {},
  ) {}

  static fromClient(client: Client): RealTemporalSchedulePort {
    return new RealTemporalSchedulePort(client.schedule);
  }

  async list(prefix: string): Promise<ExistingTemporalSchedule[]> {
    const out: ExistingTemporalSchedule[] = [];
    for await (const s of this.schedule.list()) {
      if (!s.scheduleId.startsWith(prefix)) continue;
      // list() drops cronExpressions; read memo (we write cron/tz there) or describe.
      let cron = String(s.memo?.aa_cron ?? "");
      let timezone = String(s.memo?.aa_timezone ?? s.spec?.timezone ?? "UTC");
      if (!cron) {
        try {
          const desc = await this.schedule.getHandle(s.scheduleId).describe();
          cron = String(desc.memo?.aa_cron ?? "");
          timezone = String(desc.memo?.aa_timezone ?? desc.spec.timezone ?? "UTC");
        } catch {
          // leave empty — will force an update
        }
      }
      out.push({
        scheduleId: s.scheduleId,
        cron,
        timezone,
        paused: s.state.paused,
      });
    }
    return out;
  }

  private action(args: Record<string, unknown>) {
    return {
      type: "startWorkflow" as const,
      workflowType: SCHEDULE_KICK_WORKFLOW,
      taskQueue: this.opts.taskQueue ?? WORKFLOW_TASK_QUEUE,
      args: [args],
    };
  }

  async create(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }): Promise<void> {
    await this.schedule.create({
      scheduleId: input.scheduleId,
      spec: {
        cronExpressions: [input.cron],
        timezone: input.timezone,
      },
      action: this.action(input.args),
      policies: {
        overlap: "SKIP",
        catchupWindow: this.opts.catchupWindow ?? "10 minutes",
      },
      state: { paused: input.paused },
      memo: { aa_cron: input.cron, aa_timezone: input.timezone },
    });
  }

  async update(input: {
    scheduleId: string;
    cron: string;
    timezone: string;
    paused: boolean;
    args: Record<string, unknown>;
  }): Promise<void> {
    const handle = this.schedule.getHandle(input.scheduleId);
    await handle.update((prev) => ({
      spec: {
        cronExpressions: [input.cron],
        timezone: input.timezone,
      },
      action: this.action(input.args),
      policies: prev.policies,
      state: {
        paused: input.paused,
        note: prev.state.note,
        remainingActions: prev.state.remainingActions,
      },
    }));
    // memo is not updatable via update() in all SDK versions — delete+create on cron change is OK;
    // we accept stale memo and compare via desired cron from Anytype on next pass if needed.
  }

  async delete(scheduleId: string): Promise<void> {
    await this.schedule.getHandle(scheduleId).delete();
  }

  async pause(scheduleId: string): Promise<void> {
    await this.schedule.getHandle(scheduleId).pause();
  }

  async unpause(scheduleId: string): Promise<void> {
    await this.schedule.getHandle(scheduleId).unpause();
  }
}

export interface ScheduleReconcilerOpts {
  orgId: string;
  spaceId: string;
  backend: Backend;
  schedules: TemporalSchedulePort;
  /** node:<space>:<handle> for ScheduleKick args. */
  nodeQueue: string;
  sleep?: (ms: number) => Promise<void>;
  /** How often to full-reconcile (ms). Default 30s. */
  intervalMs?: number;
}

export interface ScheduleReconciler {
  stop: () => Promise<void>;
  /** One reconcile pass (tests). */
  reconcile: () => Promise<{ applied: number; rejected: string[] }>;
}

/**
 * Watch aa_schedule objects and converge Temporal Schedules.
 */
export function startScheduleReconciler(opts: ScheduleReconcilerOpts): ScheduleReconciler {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const intervalMs = opts.intervalMs ?? 30_000;
  let stopped = false;
  const abort = new AbortController();
  /** Serialize reconcile so background loop + explicit calls / watch events cannot double-create. */
  let gate: Promise<void> = Promise.resolve();

  async function reconcileOnce(): Promise<{ applied: number; rejected: string[] }> {
    const rows = await opts.backend.org.list("aa_schedule");
    const agents = await opts.backend.org.list("aa_agent");
    const agentById = new Map<string, { lifecycle: "live" | "paused" }>();
    for (const a of agents) {
      const full = (await opts.backend.org.get(a.id)) ?? a;
      const parsed = parseAgentSpec(full, full.body);
      if (parsed.ok) {
        agentById.set(full.id, { lifecycle: parsed.spec.lifecycle });
      }
    }

    const desiredOk = [];
    const rejected: string[] = [];
    for (const row of rows) {
      const full = (await opts.backend.org.get(row.id)) ?? row;
      const fields = scheduleFieldsFromObject({
        id: full.id,
        name: full.name,
        fields: full.fields as Record<string, unknown>,
        ...(full.body !== undefined ? { body: full.body } : {}),
      });
      const agent = fields.ownerId
        ? agentById.has(fields.ownerId)
          ? { agentId: fields.ownerId, ...agentById.get(fields.ownerId)! }
          : undefined
        : undefined;
      const d = desiredSchedule(fields, opts.spaceId, agent);
      if (!d.ok) {
        rejected.push(`${full.id}: ${d.reason}`);
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "schedule-rejected",
          detail: `${full.id}: ${d.reason}`,
        });
        continue;
      }
      desiredOk.push(d);
    }

    const prefix = `schedule:${opts.spaceId}:`;
    const existing = await opts.schedules.list(prefix);
    const ops = diffSchedules(desiredOk, existing);
    let applied = 0;
    for (const op of ops) {
      if (op.op === "noop") continue;
      try {
        if (op.op === "create") {
          await opts.schedules.create({
            scheduleId: op.desired.scheduleId,
            cron: op.desired.cron,
            timezone: op.desired.timezone,
            paused: op.desired.paused,
            args: {
              orgId: opts.orgId,
              spaceId: opts.spaceId,
              scheduleId: op.desired.objectId,
              agentId: op.desired.agentId,
              nodeQueue: opts.nodeQueue,
            },
          });
          applied += 1;
        } else if (op.op === "delete") {
          await opts.schedules.delete(op.scheduleId);
          applied += 1;
        } else if (op.op === "update") {
          if (op.specChanged) {
            await opts.schedules.update({
              scheduleId: op.desired.scheduleId,
              cron: op.desired.cron,
              timezone: op.desired.timezone,
              paused: op.desired.paused,
              args: {
                orgId: opts.orgId,
                spaceId: opts.spaceId,
                scheduleId: op.desired.objectId,
                agentId: op.desired.agentId,
                nodeQueue: opts.nodeQueue,
              },
            });
          } else if (op.pause) {
            await opts.schedules.pause(op.desired.scheduleId);
          } else if (op.unpause) {
            await opts.schedules.unpause(op.desired.scheduleId);
          }
          applied += 1;
        }
      } catch (err) {
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "schedule-reconcile-error",
          detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    }
    return { applied, rejected };
  }

  async function reconcile(): Promise<{ applied: number; rejected: string[] }> {
    const prev = gate;
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await reconcileOnce();
    } finally {
      release();
    }
  }

  void (async () => {
    while (!stopped) {
      try {
        await reconcile();
      } catch (err) {
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "schedule-reconcile-error",
          detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
      // Also watch object stream for faster convergence.
      try {
        for await (const event of opts.backend.events.watch(
          { kind: "objects", type: "aa_schedule" },
          { signal: abort.signal },
        )) {
          if (stopped) return;
          if (event.kind === "ready") continue;
          await reconcile();
        }
      } catch {
        if (stopped) return;
      }
      await sleep(intervalMs);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      abort.abort();
    },
    reconcile,
  };
}
