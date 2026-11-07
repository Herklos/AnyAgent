// Scripted protocol fixture, not a simulation of Codex's persistence guarantees.
// A successful approval writes an observable effect; cancellation never does.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let pending;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "spike/requestApproval") {
    pending = { id: message.id, ...message.params };
    write({ id: "callback-1", method: pending.request.method, params: pending.request.params });
  } else if (message.id === "callback-1" && pending) {
    if (message.result?.decision === "accept") appendFileSync(pending.effectFile, "effect\n");
    write({ id: pending.id, result: { decision: message.result?.decision } });
    pending = undefined;
  }
});
