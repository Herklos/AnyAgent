/** JSON-line logging. Never log secrets or message text at the default level. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

export function log(level: LogLevel, fields: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function info(fields: Record<string, unknown>): void {
  log("info", fields);
}

export function warn(fields: Record<string, unknown>): void {
  log("warn", fields);
}

export function error(fields: Record<string, unknown>): void {
  log("error", fields);
}
