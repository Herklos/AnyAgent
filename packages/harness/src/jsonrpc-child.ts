/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/jsonrpc-child.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// JSON-RPC 2.0 over a child process's stdio, newline-delimited (the ACP transport).
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcFailure extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(e: RpcError, method: string) {
    super(`${method}: ${e.message}`);
    this.name = "RpcFailure";
    this.code = e.code;
    this.data = e.data;
  }
}

export class ChildExited extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrTail: string;
  constructor(exitCode: number | null, signal: NodeJS.Signals | null, stderrTail: string) {
    super(
      `harness process exited (code ${exitCode}, signal ${signal})${stderrTail ? `: ${stderrTail.slice(-300)}` : ""}`,
    );
    this.name = "ChildExited";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
  }
}

export type RequestHandler = (params: unknown) => Promise<unknown>;
export type NotificationHandler = (params: unknown) => void;

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr?: (text: string) => void;
}

export class JsonRpcChild {
  readonly proc: ChildProcessWithoutNullStreams;
  #nextId = 1;
  #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: string }
  >();
  #requestHandlers = new Map<string, RequestHandler>();
  #notificationHandlers = new Map<string, NotificationHandler>();
  #stderr = "";
  #exited: ChildExited | undefined;
  readonly closed: Promise<ChildExited>;

  constructor(opts: SpawnOptions) {
    this.proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.closed = new Promise((resolve) => {
      this.proc.once("close", (code, signal) => {
        this.#exited = new ChildExited(code, signal, this.#stderr);
        for (const p of this.#pending.values()) p.reject(this.#exited);
        this.#pending.clear();
        resolve(this.#exited);
      });
    });
    this.proc.once("error", (err) => {
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    });
    // EPIPE when the child died between our write and its exit is reported through `closed`.
    this.proc.stdin.on("error", () => {});
    this.proc.stderr.on("data", (b: Buffer) => {
      const s = b.toString("utf8");
      this.#stderr = (this.#stderr + s).slice(-8000);
      opts.onStderr?.(s);
    });
    createInterface({ input: this.proc.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on(
      "line",
      (line) => this.#onLine(line),
    );
  }

  get exited(): ChildExited | undefined {
    return this.#exited;
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.#requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.#notificationHandlers.set(method, handler);
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.#exited) return Promise.reject(this.#exited);
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const done =
        <V>(fn: (v: V) => void) =>
        (v: V) => {
          if (timer) clearTimeout(timer);
          fn(v);
        };
      this.#pending.set(id, {
        resolve: done(resolve as (v: unknown) => void),
        reject: done(reject),
        method,
      });
      if (timeoutMs) {
        timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.#write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.#exited) this.proc.kill(signal);
  }

  #write(msg: unknown): void {
    if (this.#exited || !this.proc.stdin.writable) return;
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  #onLine(line: string): void {
    if (!line.trim()) return;
    let m: {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: RpcError;
    };
    try {
      m = JSON.parse(line);
    } catch {
      // Not JSON: some harnesses print banners to stdout. Keep it for diagnostics, never crash.
      this.#stderr = (this.#stderr + line).slice(-8000);
      return;
    }
    if (m.method !== undefined && m.id !== undefined) {
      void this.#handleRequest(m.id, m.method, m.params);
    } else if (m.method !== undefined) {
      this.#notificationHandlers.get(m.method)?.(m.params);
    } else if (typeof m.id === "number") {
      const p = this.#pending.get(m.id);
      if (!p) return;
      this.#pending.delete(m.id);
      if (m.error) p.reject(new RpcFailure(m.error, p.method));
      else p.resolve(m.result);
    }
  }

  async #handleRequest(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.#requestHandlers.get(method);
    if (!handler) {
      this.#write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not supported: ${method}` },
      });
      return;
    }
    try {
      const result = await handler(params);
      this.#write({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (e) {
      this.#write({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}
