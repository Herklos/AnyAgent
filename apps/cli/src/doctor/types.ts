export type CheckSeverity = "pass" | "fail" | "warn";

export interface DoctorCheckResult {
  id: string;
  severity: CheckSeverity;
  /** One-line result. */
  message: string;
  /** How to fix when fail/warn. */
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheckResult[];
}

export function summarize(checks: DoctorCheckResult[]): DoctorReport {
  return {
    ok: checks.every((c) => c.severity !== "fail"),
    checks,
  };
}
