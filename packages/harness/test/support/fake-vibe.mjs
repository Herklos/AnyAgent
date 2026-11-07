#!/usr/bin/env node
/**
 * Fixture stand-in for `vibe` used by T-WP4-13a.
 * Honours a subset of flags; writes PID for cancel tests.
 */
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const pidFile = process.env.FAKE_VIBE_PID_FILE;
if (pidFile) writeFileSync(pidFile, String(process.pid));

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const mode = process.env.FAKE_VIBE_MODE ?? "ok";
const output = flag("--output") ?? "json";
const resume = flag("--resume");

if (mode === "sleep") {
  const ms = Number(process.env.FAKE_VIBE_SLEEP_MS ?? "5000");
  setTimeout(() => {}, ms);
  // keep alive until killed
  setInterval(() => {}, 1000);
} else if (mode === "exit1") {
  process.exit(1);
} else if (mode === "exit2") {
  process.exit(2);
} else if (mode === "exit3") {
  process.exit(3);
} else if (mode === "badjson") {
  process.stdout.write("not-json-at-all\n");
  process.exit(0);
} else if (mode === "streaming") {
  const sid = resume ?? "sess-stream-1";
  process.stdout.write(
    `${JSON.stringify({ type: "assistant", text: "hello ", session_id: sid })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "assistant", text: "world", session_id: sid })}\n`,
  );
  process.exit(0);
} else {
  const sid = resume ?? "sess-json-1";
  const payload = [
    { role: "assistant", content: "pong", session_id: sid, stop_reason: "end_turn" },
  ];
  if (output === "streaming") {
    for (const m of payload) process.stdout.write(`${JSON.stringify(m)}\n`);
  } else {
    process.stdout.write(JSON.stringify(payload));
  }
  if (process.env.FAKE_VIBE_LOG) {
    appendFileSync(process.env.FAKE_VIBE_LOG, `${args.join(" ")}\n`);
  }
  process.exit(0);
}
