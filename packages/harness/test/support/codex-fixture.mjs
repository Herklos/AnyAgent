// Scripted app-server protocol peer. Observable effects are only written after an explicit accept.
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

let threadId;
let count = 0;
const pending = new Map();
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const notify = (method, params) => send({ method, params });
const respond = (id, result) => send({ id, result });
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.error) throw new Error(m.error.message);
  if (m.method === "mcpServerStatus/list")
    respond(m.id, {
      data: process.env.CODEX_FIXTURE_UNEXPECTED_MCP
        ? [{ name: "untrusted", runtimeStatus: "connected", toolsError: null }]
        : [],
      nextCursor: null,
    });
  if (m.method === "initialize") respond(m.id, {});
  if (m.method === "config/read")
    respond(m.id, { config: { mcp_servers: { inherited: { enabled: true } } } });
  if (m.method === "thread/start" || m.method === "thread/resume") {
    threadId = m.params.threadId ?? `thread-${process.pid}`;
    if (m.params.config.mcp_servers.inherited.enabled !== false)
      throw new Error("Inherited MCP was not disabled");
    if (m.params.sandbox !== (process.env.CODEX_FIXTURE_SANDBOX ?? "read-only"))
      throw new Error("Unexpected sandbox");
    if (process.env.CODEX_FIXTURE_PARAMS)
      writeFileSync(process.env.CODEX_FIXTURE_PARAMS, JSON.stringify(m.params));
    respond(m.id, { thread: { id: threadId } });
  }
  if (m.method === "turn/start") {
    const turnId = `turn-${++count}`;
    respond(m.id, { turn: { id: turnId, status: "inProgress" } });
    const text = m.params.input[0].text;
    if (text === "reply") {
      notify("item/agentMessage/delta", { threadId, turnId, delta: "pong" });
      notify("thread/tokenUsage/updated", {
        threadId,
        turnId,
        tokenUsage: {
          last: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 2, totalTokens: 7 },
          total: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 2, totalTokens: 7 },
          modelContextWindow: 100,
        },
      });
      notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
    } else {
      const requestId = `callback-${turnId}`;
      pending.set(requestId, { turnId, text });
      send({
        id: requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId: text === "stale-approval" ? "old-turn" : turnId,
          itemId: `item-${turnId}`,
          kind: "command",
          command: "write effect",
          cwd: process.cwd(),
        },
      });
    }
  }
  if (m.method === "turn/interrupt") {
    pending.clear();
    respond(m.id, {});
    notify("turn/completed", { threadId, turn: { id: m.params.turnId, status: "interrupted" } });
  }
  if (m.id && pending.has(m.id) && m.result) {
    const { turnId, text } = pending.get(m.id);
    pending.delete(m.id);
    if (text === "hold-before-effect") return;
    if (m.result.decision === "accept")
      appendFileSync(process.env.CODEX_FIXTURE_EFFECTS, "effect\n");
    if (text === "crash-after-effect") process.exit(23);
    if (text === "hold-after-effect") return;
    notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  }
});

process.stdin.on("end", () => process.exit(0));
