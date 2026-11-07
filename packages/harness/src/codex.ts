/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/codex.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// Native Codex app-server sessions. Interruption recovery belongs to the node's durable turn journal.
import { createHash } from "node:crypto";
import { JsonRpcChild } from "./jsonrpc-child.js";
import { codex } from "./registry.js";
import type {
  EventSink,
  HarnessSession,
  PermissionHandler,
  SessionHandle,
  SessionInit,
  TurnInput,
  TurnResult,
  UsageInfo,
} from "./types.js";

interface NativeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
}
const usageInfo = (u: NativeUsage): UsageInfo => ({
  inputTokens: u.inputTokens,
  outputTokens: u.outputTokens,
  cachedReadTokens: u.cachedInputTokens,
  cachedWriteTokens: u.cacheWriteInputTokens ?? 0,
  totalTokens: u.totalTokens,
});
const difference = (a: UsageInfo, b: UsageInfo): UsageInfo => ({
  inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
  outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  cachedReadTokens: Math.max(0, a.cachedReadTokens - b.cachedReadTokens),
  cachedWriteTokens: Math.max(0, a.cachedWriteTokens - b.cachedWriteTokens),
  totalTokens: Math.max(0, a.totalTokens - b.totalTokens),
});

interface NativeTurn {
  id: string;
  status: string;
  error?: { message: string } | null;
}
interface Approval {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  command?: string | null;
  kind?: string;
  grantRoot?: string | null;
  [key: string]: unknown;
}

/** Hash native scope, never JSON-RPC routing IDs or command text. */
export function codexApprovalId(method: string, p: Approval): string {
  return `codex-${createHash("sha256")
    .update(JSON.stringify([method, p.threadId, p.turnId, p.itemId, p.approvalId ?? null]))
    .digest("hex")}`;
}

/**
 * The Codex sandbox for a Michel approval mode. Michel keeps asking through `approvalPolicy: "untrusted"` in every
 * mode, so its floor and its allow-lists still see each command; the sandbox is what the operating system enforces
 * under that. `read_only` and `ask` keep the read-only sandbox. `auto` may write the agent's folder and
 * `writableRoots` and has no network. `full` has no sandbox.
 */
export function codexSandbox(
  mode: SessionInit["approvalMode"],
): "read-only" | "workspace-write" | "danger-full-access" {
  if (mode === "auto") return "workspace-write";
  if (mode === "full") return "danger-full-access";
  return "read-only";
}

export class CodexSession implements HarnessSession {
  readonly handle: SessionHandle;
  readonly #rpc: JsonRpcChild;
  readonly #effort: string | undefined;
  #active:
    | {
        sink: EventSink;
        permission: PermissionHandler;
        nativeTurn: Promise<string | undefined>;
        text: string;
        usage?: UsageInfo;
        baseline?: UsageInfo;
        resolve: (r: TurnResult) => void;
        reject: (e: Error) => void;
      }
    | undefined;
  #turnId: string | undefined;
  readonly #files = new Map<string, { turnId: string; changes: unknown }>();

  private constructor(rpc: JsonRpcChild, id: string, init: SessionInit) {
    this.#rpc = rpc;
    this.#effort = init.effort;
    this.handle = {
      sessionId: id,
      harness: "codex",
      cwd: init.cwd,
      capabilities: {
        loadSession: true,
        resumeSession: true,
        images: false,
        mcpHttp: false,
        mcpSse: false,
        agentName: "codex",
      },
    };
    for (const method of [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ]) {
      rpc.onRequest(method, async (p) => {
        try {
          return await this.#approval(method, p as Approval);
        } catch (e) {
          this.#active?.reject(e instanceof Error ? e : new Error(String(e)));
          this.kill();
          throw e;
        }
      });
    }
    rpc.onNotification("item/agentMessage/delta", (v) => {
      const p = v as { threadId: string; delta: string };
      if (p.threadId !== id || !this.#active) return;
      this.#active.text += p.delta;
      this.#active.sink({ type: "text_delta", text: p.delta });
    });
    for (const method of ["item/started", "item/completed"]) {
      rpc.onNotification(method, (v) => {
        const p = v as {
          threadId: string;
          turnId: string;
          item: {
            id: string;
            type: string;
            command?: string;
            status?: string;
            aggregatedOutput?: string;
            changes?: unknown;
          };
        };
        if (
          p.threadId !== id ||
          !this.#active ||
          !["commandExecution", "fileChange", "mcpToolCall"].includes(p.item.type)
        )
          return;
        if (p.item.type === "fileChange" && p.item.changes !== undefined)
          this.#files.set(p.item.id, { turnId: p.turnId, changes: p.item.changes });
        this.#active.sink({
          type: "tool",
          toolCallId: p.item.id,
          title: p.item.command ?? p.item.type,
          status:
            method === "item/started"
              ? "in_progress"
              : p.item.status === "failed"
                ? "failed"
                : "completed",
          rawInput: p.item,
          rawOutput: p.item.aggregatedOutput,
        });
      });
    }
    rpc.onNotification("thread/tokenUsage/updated", (v) => {
      const p = v as {
        threadId: string;
        tokenUsage: { last: NativeUsage; total: NativeUsage; modelContextWindow: number | null };
      };
      if (p.threadId !== id || !this.#active) return;
      const last = usageInfo(p.tokenUsage.last);
      const total = usageInfo(p.tokenUsage.total);
      // Native totals accumulate across the thread. Infer the boundary from its first response,
      // then include every model interaction in this Michel turn, including tool round trips.
      this.#active.baseline ??= difference(total, last);
      this.#active.usage = difference(total, this.#active.baseline);
      this.#active.sink({
        type: "usage",
        used: last.totalTokens,
        size: p.tokenUsage.modelContextWindow ?? 0,
      });
    });
    rpc.onNotification("turn/completed", (v) => {
      const p = v as { threadId: string; turn: NativeTurn };
      if (p.threadId !== id || !this.#active) return;
      const a = this.#active;
      void a.nativeTurn.then((turnId) => {
        if (this.#active !== a || p.turn.id !== turnId) return;
        if (!["completed", "interrupted", "failed"].includes(p.turn.status))
          a.reject(new Error(`Unknown Codex turn status: ${p.turn.status}`));
        else if (p.turn.status === "failed")
          a.reject(new Error(p.turn.error?.message ?? "Codex turn failed"));
        else
          a.resolve({
            stopReason: p.turn.status === "interrupted" ? "cancelled" : "end_turn",
            text: a.text,
            ...(a.usage ? { usage: a.usage } : {}),
          });
      });
    });
    rpc.closed.then((e) => this.#active?.reject(e));
  }

  static async open(
    init: SessionInit,
    resumeId?: string,
    onStderr?: (t: string) => void,
    spawn = codex.spawn(init),
  ): Promise<{ session: CodexSession; resumed: "resume" | "none" }> {
    const rpc = new JsonRpcChild({
      ...spawn,
      cwd: init.cwd,
      env: init.env ?? process.env,
      ...(onStderr ? { onStderr } : {}),
    });
    try {
      await rpc.request("initialize", { clientInfo: { name: "anybot", version: "0.0.0" } }, 30_000);
      rpc.notify("initialized");
      // Config tables merge with user/project config. Explicitly disable every inherited server.
      const inherited = await rpc.request<{ config: { mcp_servers?: Record<string, unknown> } }>(
        "config/read",
        { cwd: init.cwd },
        30_000,
      );
      const servers: Record<string, unknown> = Object.fromEntries(
        Object.keys(inherited.config.mcp_servers ?? {}).map((name) => [name, { enabled: false }]),
      );
      for (const s of init.mcpServers ?? [])
        servers[s.name] = {
          enabled: true,
          ...(s.name === "michel" ? { default_tools_approval_mode: "approve" } : {}),
          command: s.command,
          args: s.args,
          env: Object.fromEntries(s.env.map((e) => [e.name, e.value])),
        };
      const params = {
        cwd: init.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: codexSandbox(init.approvalMode),
        config: {
          mcp_servers: servers,
          "features.hooks": false,
          "features.plugins": false,
          "features.apps": false,
          ...(init.approvalMode === "auto"
            ? {
                "sandbox_workspace_write.writable_roots": init.writableRoots ?? [],
                "sandbox_workspace_write.network_access": false,
              }
            : {}),
        },
        developerInstructions: init.instructions ?? "",
        ...(init.model ? { model: init.model } : {}),
      };
      const r = await rpc.request<{ thread: { id: string } }>(
        resumeId ? "thread/resume" : "thread/start",
        { ...params, ...(resumeId ? { threadId: resumeId } : { ephemeral: false }) },
        60_000,
      );
      const session = new CodexSession(rpc, r.thread.id, init);
      const allowed = new Set((init.mcpServers ?? []).map((s) => s.name));
      const deadline = Date.now() + 60_000;
      for (;;) {
        const inventory = await session.mcpInventory();
        for (const server of inventory) {
          if (server.runtimeStatus === "disabled") continue;
          if (!allowed.has(server.name))
            throw new Error(`Unexpected MCP server in Codex thread: ${server.name}`);
          if (server.toolsError) throw new Error(`Codex MCP ${server.name}: ${server.toolsError}`);
          if (
            ["failed", "cancelled", "authenticationRequired"].includes(server.runtimeStatus ?? "")
          ) {
            throw new Error(`Codex MCP ${server.name}: ${server.runtimeStatus}`);
          }
        }
        if (
          [...allowed].every((name) =>
            inventory.some((s) => s.name === name && s.runtimeStatus === "connected"),
          )
        )
          break;
        if (Date.now() >= deadline) throw new Error("Timed out connecting Codex MCP servers");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { session, resumed: resumeId ? "resume" : "none" };
    } catch (e) {
      rpc.kill("SIGKILL");
      throw e;
    }
  }

  async mcpInventory(): Promise<
    { name: string; runtimeStatus: string | null; toolsError: string | null }[]
  > {
    const data: { name: string; runtimeStatus: string | null; toolsError: string | null }[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: typeof data; nextCursor: string | null } = await this.#rpc.request(
        "mcpServerStatus/list",
        {
          threadId: this.handle.sessionId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        },
        60_000,
      );
      data.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return data;
  }

  async #approval(method: string, p: Approval): Promise<unknown> {
    const a = this.#active;
    if (!a || p.threadId !== this.handle.sessionId || !p.turnId || !p.itemId)
      return { decision: "cancel" };
    const nativeTurn = await a.nativeTurn;
    if (this.#active !== a || p.turnId !== nativeTurn) {
      a.reject(
        new Error("Codex approval belongs to a different native turn; reconciliation required"),
      );
      this.kill();
      return { decision: "cancel" };
    }
    const isCommand = method === "item/commandExecution/requestApproval";
    const file = this.#files.get(p.itemId);
    if (!isCommand && (!file || file.turnId !== p.turnId))
      throw new Error("Codex file approval is missing its proposed changes");
    const req = {
      requestId: codexApprovalId(method, p),
      sessionId: p.threadId,
      toolCallId: p.itemId,
      title: p.command ?? "Codex file change",
      toolName: isCommand ? "codex_command" : "codex_file_change",
      kind: isCommand && (!p.kind || p.kind === "command") ? "execute" : "edit",
      rawInput: { ...p, method, ...(!isCommand && file ? { changes: file.changes } : {}) },
      options: [
        { optionId: "accept", name: "Allow once", kind: "allow_once" },
        { optionId: "decline", name: "Deny", kind: "reject_once" },
      ],
    };
    // A session-wide file grant cannot be represented as Michel's one-call approval.
    if (p.grantRoot) return { decision: "decline" };
    const d = await a.permission(req);
    return {
      decision:
        d.outcome === "selected" && d.optionId === "accept"
          ? "accept"
          : d.outcome === "cancelled"
            ? "cancel"
            : "decline",
    };
  }

  async prompt(
    input: TurnInput,
    sink: EventSink,
    permission: PermissionHandler,
  ): Promise<TurnResult> {
    if (this.#active) throw new Error("a turn is already running");
    this.#files.clear();
    let resolve: (v: TurnResult) => void = () => {};
    let reject: (e: Error) => void = () => {};
    const done = new Promise<TurnResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    let ready: (id: string | undefined) => void = () => {};
    const nativeTurn = new Promise<string | undefined>((resolve) => {
      ready = resolve;
    });
    this.#active = { sink, permission, text: "", resolve, reject, nativeTurn };
    try {
      // Observe process failure even while turn/start is awaiting its acknowledgement.
      const started = this.#rpc.request<{ turn: NativeTurn }>(
        "turn/start",
        {
          threadId: this.handle.sessionId,
          input: [{ type: "text", text: input.text, text_elements: [] }],
          ...(this.#effort ? { effort: this.#effort } : {}),
        },
        60_000,
      );
      const first = await Promise.race([started, done]);
      if ("turn" in first) {
        this.#turnId = first.turn.id;
        ready(first.turn.id);
        return await done;
      }
      return first;
    } finally {
      ready(undefined);
      this.#active = undefined;
      this.#turnId = undefined;
    }
  }
  get exited() {
    return this.#rpc.exited;
  }
  get closed() {
    return this.#rpc.closed;
  }
  get pid() {
    return this.#rpc.proc.pid;
  }
  cancel(): void {
    if (this.#turnId)
      void this.#rpc
        .request(
          "turn/interrupt",
          { threadId: this.handle.sessionId, turnId: this.#turnId },
          10_000,
        )
        .catch(() => this.kill());
    else this.kill();
  }
  kill(): void {
    this.#rpc.kill("SIGKILL");
  }
  async close(): Promise<void> {
    this.kill();
    await this.closed;
  }
}
