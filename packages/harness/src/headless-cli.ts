/**
 * Headless CLI harness kind (ADR 0020). New code for AnyBot — not copied from Michel.
 * Used by Mistral Vibe: spawn a process per turn, parse JSON/streaming output, no permission callbacks.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  EventSink,
  HarnessSession,
  PermissionHandler,
  SessionHandle,
  SessionInit,
  TurnInput,
  TurnResult,
} from "./types.js";

export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

export type HeadlessOutputMode = "json" | "streaming" | "text";

export interface HeadlessCliDescriptor {
  id: string;
  label: string;
  /** Always false for this kind — host cannot answer tool approvals. */
  permissionCallbacks: false;
  command: string;
  /** Build argv for one turn (prompt already decided). */
  buildArgs: (opts: {
    prompt: string;
    mode: "read_only" | "full";
    model?: string;
    resumeSessionId?: string;
    output: HeadlessOutputMode;
  }) => string[];
  output: HeadlessOutputMode;
  parseOutput: (
    stdout: string,
    output: HeadlessOutputMode,
  ) => {
    text: string;
    sessionId?: string;
    stopReason: string;
    usage?: TurnResult["usage"];
  };
  mapExitCode: (code: number | null) => "ok" | "harness_error" | "limit";
  timeoutMs?: number;
  envKeys?: readonly string[];
}

export interface VibeJsonMessage {
  type?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  text?: string;
  session_id?: string;
  sessionId?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

/** Parse Vibe `--output json` (array) or streaming (NDJSON). Fails loudly on unexpected shape. */
export function parseVibeOutput(
  stdout: string,
  output: HeadlessOutputMode,
): { text: string; sessionId?: string; stopReason: string; usage?: TurnResult["usage"] } {
  const trimmed = stdout.trim();
  if (output === "text") {
    return { text: trimmed, stopReason: "end_turn" };
  }

  const lines =
    output === "streaming"
      ? trimmed.split("\n").filter((l) => l.trim())
      : trimmed.startsWith("[")
        ? null
        : trimmed.split("\n").filter((l) => l.trim());

  let messages: VibeJsonMessage[];
  if (output === "json" || (trimmed.startsWith("[") && output !== "streaming")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new HarnessError(`vibe json: cannot parse output: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new HarnessError(`vibe json: expected a JSON array, got ${typeof parsed}`);
    }
    messages = parsed as VibeJsonMessage[];
  } else {
    messages = (lines ?? []).map((line, i) => {
      try {
        return JSON.parse(line) as VibeJsonMessage;
      } catch (e) {
        throw new HarnessError(
          `vibe streaming: cannot parse line ${i + 1}: ${line.slice(0, 120)} (${(e as Error).message})`,
        );
      }
    });
  }

  const texts: string[] = [];
  let sessionId: string | undefined;
  let stopReason = "end_turn";
  let usage: TurnResult["usage"] | undefined;

  for (const m of messages) {
    if (m.session_id) sessionId = m.session_id;
    if (m.sessionId) sessionId = m.sessionId;
    if (m.stop_reason) stopReason = m.stop_reason;
    if (m.usage) {
      usage = {
        inputTokens: m.usage.input_tokens ?? 0,
        outputTokens: m.usage.output_tokens ?? 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        totalTokens:
          m.usage.total_tokens ?? (m.usage.input_tokens ?? 0) + (m.usage.output_tokens ?? 0),
      };
    }
    if (typeof m.text === "string") texts.push(m.text);
    else if (typeof m.content === "string") texts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part.text === "string") texts.push(part.text);
      }
    } else if (m.type === "assistant" || m.role === "assistant") {
      // message with no extractable text — ignore
    }
  }

  return {
    text: texts.join(""),
    ...(sessionId ? { sessionId } : {}),
    stopReason,
    ...(usage ? { usage } : {}),
  };
}

export function vibeDescriptor(): HeadlessCliDescriptor {
  return {
    id: "vibe",
    label: "Mistral Vibe",
    permissionCallbacks: false,
    command: "vibe",
    output: "json",
    buildArgs: ({ prompt, mode, model, resumeSessionId, output }) => {
      const args = ["-p", prompt, "--output", output];
      if (mode === "read_only") {
        args.push("--agent", "ask", "--enabled-tools", "read_file", "--enabled-tools", "list_dir");
      } else {
        args.push("--agent", "auto-approve", "--auto-approve");
      }
      if (model) args.push("--model", model);
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      args.push("--max-turns", "32", "--time-limit", "600");
      return args;
    },
    parseOutput: parseVibeOutput,
    mapExitCode: (code) => {
      if (code === 0) return "ok";
      if (code === 3) return "limit";
      return "harness_error";
    },
    timeoutMs: 600_000,
    envKeys: ["VIBE_HOME", "HOME"],
  };
}

export class HeadlessCliSession implements HarnessSession {
  readonly handle: SessionHandle;
  readonly #desc: HeadlessCliDescriptor;
  readonly #init: SessionInit;
  readonly #mode: "read_only" | "full";
  #child: ChildProcess | undefined;
  #exited: Error | undefined;
  #closedResolve!: (e: Error) => void;
  readonly closed: Promise<Error>;
  #sessionId: string;

  constructor(
    desc: HeadlessCliDescriptor,
    init: SessionInit,
    mode: "read_only" | "full",
    sessionId = `headless-${desc.id}-${Date.now()}`,
  ) {
    this.#desc = desc;
    this.#init = init;
    this.#mode = mode;
    this.#sessionId = sessionId;
    this.handle = {
      sessionId,
      harness: desc.id,
      cwd: init.cwd,
      capabilities: {
        loadSession: false,
        resumeSession: true,
        images: false,
        mcpHttp: false,
        mcpSse: false,
        agentName: desc.label,
      },
    };
    this.closed = new Promise((r) => {
      this.#closedResolve = r;
    });
  }

  get exited(): Error | undefined {
    return this.#exited;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  async prompt(
    input: TurnInput,
    sink: EventSink,
    _onPermission: PermissionHandler,
  ): Promise<TurnResult> {
    void _onPermission; // headless: never called
    const buildOpts: Parameters<HeadlessCliDescriptor["buildArgs"]>[0] = {
      prompt: input.text,
      mode: this.#mode,
      output: this.#desc.output,
    };
    if (this.#init.model) buildOpts.model = this.#init.model;
    if (!this.#sessionId.startsWith("headless-")) buildOpts.resumeSessionId = this.#sessionId;
    const args = this.#desc.buildArgs(buildOpts);

    const env = { ...process.env, ...this.#init.env };
    const child = spawn(this.#desc.command, args, {
      cwd: this.#init.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    if (this.#desc.output === "streaming" && child.stdout) {
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        stdout += `${line}\n`;
        sink({ type: "text_delta", text: `${line}\n` });
      }
    } else {
      child.stdout?.on("data", (c: string) => {
        stdout += c;
      });
    }
    child.stderr?.on("data", (c: string) => {
      stderr += c;
      sink({ type: "stderr", text: c });
    });

    const code: number | null = await new Promise((resolve) => {
      const t = this.#desc.timeoutMs
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 2_000);
          }, this.#desc.timeoutMs)
        : undefined;
      child.on("close", (c) => {
        if (t) clearTimeout(t);
        resolve(c);
      });
      child.on("error", (e) => {
        if (t) clearTimeout(t);
        this.#exited = e;
        this.#closedResolve(e);
        resolve(1);
      });
    });

    this.#child = undefined;
    const mapped = this.#desc.mapExitCode(code);
    if (mapped === "harness_error") {
      throw new HarnessError(
        `${this.#desc.id} exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ""}`,
      );
    }
    if (mapped === "limit") {
      return { stopReason: "max_turn_requests", text: stdout.trim() };
    }

    const parsed = this.#desc.parseOutput(stdout, this.#desc.output);
    if (parsed.sessionId) {
      this.#sessionId = parsed.sessionId;
      this.handle.sessionId = parsed.sessionId;
    }
    if (parsed.text) sink({ type: "text_delta", text: parsed.text });

    return {
      stopReason: parsed.stopReason,
      text: parsed.text,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }

  cancel(): void {
    const c = this.#child;
    if (!c?.pid) return;
    c.kill("SIGTERM");
    setTimeout(() => {
      try {
        c.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 2_000);
  }

  async close(): Promise<void> {
    this.kill();
    const err = this.#exited ?? new Error("closed");
    this.#closedResolve(err);
  }

  kill(): void {
    const c = this.#child;
    if (!c?.pid) return;
    try {
      c.kill("SIGKILL");
    } catch {
      // ignore
    }
    this.#child = undefined;
  }
}
