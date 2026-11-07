import { ALL_CHECKS, type DoctorDeps, RUN_GATE_CHECKS } from "./checks.js";
import { type DoctorReport, summarize } from "./types.js";

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const checks = [];
  for (const fn of ALL_CHECKS) {
    checks.push(await fn(deps));
  }
  return summarize(checks);
}

export async function runGateChecks(deps: DoctorDeps): Promise<DoctorReport> {
  const checks = [];
  for (const fn of RUN_GATE_CHECKS) {
    checks.push(await fn(deps));
  }
  return summarize(checks);
}

export type { DoctorCheckResult, DoctorReport } from "./types.js";
export type { DoctorDeps };
