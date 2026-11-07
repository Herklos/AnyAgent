/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/fake-agent-main.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// A scripted ACP agent over stdio. Run by tests through the "fake" harness descriptor.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { FakeScript, FakeStep } from "./fake-agent.js";

const scriptPath = process.env.ANYAGENT_FAKE_SCRIPT;
const stateDir = process.env.ANYAGENT_FAKE_STATE_DIR ?? join(process.cwd(), ".fake-agent");
mkdirSync(stateDir, { recursive: true });
const script: FakeScript =
  scriptPath && existsSync(scriptPath)
    ? JSON.parse(readFileSync(scriptPath, "utf8"))
    : { turns: [] };
const sessionsFile = join(stateDir, "sessions.json");
const effectsLog = join(stateDir, "effects.log");

// done: step indexes already completed for the prompt in flight, so a "continue" prompt after a
// restart skips them, as a real agent that can read its own transcript would.
type Sessions = Record<
  string,
  { cwd: string; prompts: number; turnText?: string; done?: number[] }
>;
const loadSessions = (): Sessions =>
  existsSync(sessionsFile) ? JSON.parse(readFileSync(sessionsFile, "utf8")) : {};
const saveSessions = (s: Sessions) => writeFileSync(sessionsFile, JSON.stringify(s));

const out = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
const pendingClient = new Map<number, (r: { result?: unknown; error?: unknown }) => void>();
let nextId = 1000;
const cancelled = new Set<string>();

function clientRequest(
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
  const id = nextId++;
  return new Promise((res) => {
    pendingClient.set(id, res);
    out({ jsonrpc: "2.0", id, method, params });
  });
}

const update = (sessionId: string, u: Record<string, unknown>) =>
  out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let authenticated = false;
const record = (line: string) => appendFileSync(effectsLog, `${line}\n`);

async function runStep(
  sessionId: string,
  cwd: string,
  step: FakeStep,
  usage: { in: number; out: number; cost?: number },
): Promise<void> {
  if ("say" in step) {
    const words = step.say.split(/(?<= )/);
    for (const w of words) {
      update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: w },
        messageId: "m1",
      });
      await sleep(2);
    }
  } else if ("think" in step) {
    update(sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: step.think },
    });
  } else if ("sleep" in step) {
    await sleep(step.sleep);
  } else if ("usage" in step) {
    usage.in += step.usage.input;
    usage.out += step.usage.output;
    if (step.usage.costUsd !== undefined) usage.cost = (usage.cost ?? 0) + step.usage.costUsd;
    update(sessionId, {
      sessionUpdate: "usage_update",
      used: usage.in + usage.out,
      size: 200000,
      ...(usage.cost !== undefined ? { cost: { amount: usage.cost, currency: "USD" } } : {}),
    });
  } else if ("tool" in step) {
    const t = step.tool;
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: t.id,
      title: t.title,
      kind: t.kind ?? "other",
      status: "pending",
      rawInput: t.rawInput ?? {},
    });
    let allowed = true;
    if (t.permission) {
      const r = await clientRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: t.id,
          title: t.title,
          kind: t.kind ?? "other",
          rawInput: t.rawInput ?? {},
          status: "pending",
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      const outcome = (
        r.result as { outcome?: { outcome?: string; optionId?: string } } | undefined
      )?.outcome;
      allowed = outcome?.outcome === "selected" && outcome.optionId !== "reject";
    }
    if (!allowed) {
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: t.id,
        status: "failed",
        rawOutput: "denied",
      });
      return;
    }
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: t.id,
      status: "in_progress",
    });
    if (t.effect?.writeFile) {
      const target = resolve(cwd, t.effect.writeFile.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, t.effect.writeFile.content);
      record(`write ${target}`);
    }
    if (t.effect?.log) record(t.effect.log);
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: t.id,
      status: "completed",
      rawOutput: "ok",
    });
  } else if ("crash" in step) {
    if (!existsSync(step.crash.marker)) {
      writeFileSync(step.crash.marker, "crashed");
      process.kill(process.pid, "SIGKILL");
    }
  }
}

async function handle(m: { id?: number; method: string; params?: Record<string, unknown> }) {
  const p = (m.params ?? {}) as Record<string, string | undefined> & {
    prompt?: { text?: string }[];
  };
  switch (m.method) {
    case "initialize":
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: script.capabilities?.loadSession ?? true,
          promptCapabilities: { image: false },
          mcpCapabilities: { http: false, sse: false },
          ...(script.capabilities?.resume === false ? {} : { sessionCapabilities: { resume: {} } }),
        },
        agentInfo: { name: "anyagent-fake-agent", version: "0.0.0" },
        authMethods: (script.authMethods ?? []).map((id) => ({ id, name: id })),
      };
    case "authenticate": {
      const id = (m.params as { methodId?: string } | undefined)?.methodId;
      if (!id || !(script.authMethods ?? []).includes(id))
        throw new Error(`unknown auth method ${id}`);
      record(`authenticate ${id}`);
      authenticated = true;
      return {};
    }
    case "session/new": {
      if ((script.authMethods ?? []).length > 0 && !authenticated)
        throw new Error("authentication required");
      const sessionId = `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const s = loadSessions();
      s[sessionId] = { cwd: p.cwd ?? process.cwd(), prompts: 0 };
      saveSessions(s);
      return { sessionId };
    }
    case "session/resume":
    case "session/load": {
      const s = loadSessions();
      if (!p.sessionId || !s[p.sessionId]) throw new Error("unknown session");
      return {};
    }
    case "session/set_mode":
      return {};
    case "session/prompt": {
      const sessionId = p.sessionId as string;
      const s = loadSessions();
      const sess = s[sessionId];
      if (!sess) throw new Error("unknown session");
      const text = (p.prompt ?? []).map((b) => b.text ?? "").join("\n");
      const continuing = text.includes("interrupted by a restart") && sess.turnText !== undefined;
      if (!continuing) {
        sess.prompts += 1;
        sess.turnText = text;
        sess.done = [];
      }
      saveSessions(s);
      const matchText = continuing ? (sess.turnText as string) : text;
      const turn =
        script.turns.find((t) => t.match && text.includes(t.match)) ??
        [...script.turns].reverse().find((t) => !t.match);
      const steps: FakeStep[] = turn?.steps ?? [{ say: `fake: ${matchText}` }];
      const usage: { in: number; out: number; cost?: number } = { in: 0, out: 0 };
      for (const [i, step] of steps.entries()) {
        if (cancelled.delete(sessionId)) return { stopReason: "cancelled" };
        if (continuing && sess.done?.includes(i)) continue;
        await runStep(sessionId, sess.cwd, step, usage);
        const cur = loadSessions();
        const c = cur[sessionId];
        if (c) {
          c.done = [...(c.done ?? []), i];
          saveSessions(cur);
        }
      }
      return {
        stopReason: "end_turn",
        usage: {
          inputTokens: usage.in,
          outputTokens: usage.out,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          totalTokens: usage.in + usage.out,
        },
      };
    }
    default:
      throw Object.assign(new Error(`unsupported: ${m.method}`), { code: -32601 });
  }
}

// A real harness exits when its client goes away.
process.stdin.on("end", () => process.exit(0));
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.method === undefined && m.id !== undefined) {
    pendingClient.get(m.id)?.(m);
    pendingClient.delete(m.id);
    return;
  }
  if (m.method === "session/cancel") {
    cancelled.add(m.params?.sessionId);
    return;
  }
  if (m.id === undefined) return;
  handle(m).then(
    (result) => out({ jsonrpc: "2.0", id: m.id, result }),
    (e: Error & { code?: number }) =>
      out({ jsonrpc: "2.0", id: m.id, error: { code: e.code ?? -32000, message: e.message } }),
  );
});
