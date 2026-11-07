/**
 * Parse and validate aa_schedule fields; desired Temporal schedule state + diff (WP4).
 */
import { Cron } from "croner";

export interface ScheduleSpecFields {
  /** Object id of the aa_schedule. */
  objectId: string;
  name: string;
  /** Owner aa_agent id. */
  ownerId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  /** Prompt body. */
  body: string;
}

export interface AgentLifecycleView {
  agentId: string;
  lifecycle: "live" | "paused";
}

export type ParseScheduleResult =
  | { ok: true; cron: string; timezone: string }
  | { ok: false; reason: string };

export type DesiredSchedule =
  | {
      ok: true;
      scheduleId: string;
      cron: string;
      timezone: string;
      paused: boolean;
      agentId: string;
      objectId: string;
      name: string;
    }
  | { ok: false; objectId: string; reason: string };

export interface ExistingTemporalSchedule {
  scheduleId: string;
  cron: string;
  timezone: string;
  paused: boolean;
}

export type ScheduleDiffOp =
  | { op: "create"; desired: Extract<DesiredSchedule, { ok: true }> }
  | {
      op: "update";
      desired: Extract<DesiredSchedule, { ok: true }>;
      existing: ExistingTemporalSchedule;
      pause?: boolean;
      unpause?: boolean;
      specChanged?: boolean;
    }
  | { op: "delete"; scheduleId: string }
  | { op: "noop"; scheduleId: string };

const FIVE_FIELD = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

/** True when `zone` is a valid IANA time zone. */
export function isValidIanaZone(zone: string): boolean {
  if (!zone || /\s/.test(zone)) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a 5-field cron and IANA zone. Rejects 6-field (seconds) crons.
 * Uses croner to confirm the expression is executable in the zone.
 */
export function parseScheduleCron(cron: string, timezone: string): ParseScheduleResult {
  const trimmed = cron.trim();
  if (!FIVE_FIELD.test(trimmed)) {
    return { ok: false, reason: "cron must be exactly 5 fields (min hour dom mon dow)" };
  }
  if (!isValidIanaZone(timezone)) {
    return { ok: false, reason: `unknown timezone: ${timezone}` };
  }
  try {
    // croner accepts 5- or 6-field; we already enforced 5.
    const job = new Cron(trimmed, { timezone, paused: true });
    const next = job.nextRun();
    if (!next) {
      return { ok: false, reason: "cron produces no next run" };
    }
    return { ok: true, cron: trimmed, timezone };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : `invalid cron: ${String(err)}`,
    };
  }
}

/** Next N run times as ISO strings (for tests / projection helpers). */
export function nextRunTimes(
  cron: string,
  timezone: string,
  count: number,
  from: Date = new Date(),
): string[] {
  const parsed = parseScheduleCron(cron, timezone);
  if (!parsed.ok) return [];
  const job = new Cron(parsed.cron, { timezone, paused: true });
  const out: string[] = [];
  let cursor: Date | null = from;
  for (let i = 0; i < count; i++) {
    const n = job.nextRun(cursor ?? undefined);
    if (!n) break;
    out.push(n.toISOString());
    cursor = new Date(n.getTime() + 1000);
  }
  return out;
}

export function temporalScheduleId(spaceId: string, objectId: string): string {
  return `schedule:${spaceId}:${objectId}`;
}

/**
 * Desired Temporal Schedule for one aa_schedule object.
 * Paused unless enabled and owner agent exists and is live.
 */
export function desiredSchedule(
  fields: ScheduleSpecFields,
  spaceId: string,
  agent: AgentLifecycleView | undefined,
): DesiredSchedule {
  const parsed = parseScheduleCron(fields.cron, fields.timezone);
  if (!parsed.ok) {
    return { ok: false, objectId: fields.objectId, reason: parsed.reason };
  }
  if (!fields.ownerId) {
    return { ok: false, objectId: fields.objectId, reason: "missing aa_owner" };
  }
  const running = Boolean(fields.enabled && agent && agent.lifecycle === "live");
  return {
    ok: true,
    scheduleId: temporalScheduleId(spaceId, fields.objectId),
    cron: parsed.cron,
    timezone: parsed.timezone,
    paused: !running,
    agentId: fields.ownerId,
    objectId: fields.objectId,
    name: fields.name,
  };
}

/**
 * Diff desired vs existing Temporal schedules (prefix `schedule:<spaceId>:`).
 * Idempotent: equal → noop; missing → create; extra → delete; differ → update.
 */
export function diffSchedules(
  desired: Array<Extract<DesiredSchedule, { ok: true }>>,
  existing: ExistingTemporalSchedule[],
): ScheduleDiffOp[] {
  const want = new Map(desired.map((d) => [d.scheduleId, d]));
  const have = new Map(existing.map((e) => [e.scheduleId, e]));
  const ops: ScheduleDiffOp[] = [];

  for (const [id, d] of want) {
    const e = have.get(id);
    if (!e) {
      ops.push({ op: "create", desired: d });
      continue;
    }
    const specChanged = e.cron !== d.cron || e.timezone !== d.timezone;
    const pause = !e.paused && d.paused;
    const unpause = e.paused && !d.paused;
    if (!specChanged && !pause && !unpause) {
      ops.push({ op: "noop", scheduleId: id });
      continue;
    }
    ops.push({
      op: "update",
      desired: d,
      existing: e,
      ...(pause ? { pause: true } : {}),
      ...(unpause ? { unpause: true } : {}),
      ...(specChanged ? { specChanged: true } : {}),
    });
  }

  for (const [id] of have) {
    if (!want.has(id)) ops.push({ op: "delete", scheduleId: id });
  }
  return ops;
}

/** Coerce Anytype field values into ScheduleSpecFields. */
export function scheduleFieldsFromObject(input: {
  id: string;
  name: string;
  fields: Record<string, unknown>;
  body?: string;
}): ScheduleSpecFields {
  const enabledRaw = input.fields.aa_enabled;
  const enabled =
    enabledRaw === true ||
    enabledRaw === "true" ||
    enabledRaw === 1 ||
    enabledRaw === "1" ||
    enabledRaw === "yes";
  return {
    objectId: input.id,
    name: input.name || input.id,
    ownerId: String(input.fields.aa_owner ?? ""),
    cron: String(input.fields.aa_cron ?? ""),
    timezone: String(input.fields.aa_timezone ?? ""),
    enabled,
    body: input.body ?? "",
  };
}
