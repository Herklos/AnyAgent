/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/acp.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// An ACP client for one harness process (ADR 0003). Michel is the client: it starts the agent,
// opens or resumes a session, sends prompts, relays session/update notifications to an event sink
// and answers session/request_permission through a handler (the approval bridge).
import { JsonRpcChild, RpcFailure } from "./jsonrpc-child.js";
import type { HarnessDescriptor } from "./registry.js";
import type {
  AdapterCapabilities,
  AdapterEvent,
  EventSink,
  PermissionDecision,
  PermissionHandler,
  PermissionOption,
  PermissionRequest,
  SessionHandle,
  SessionInit,
  ToolStatus,
  TurnInput,
  TurnResult,
  UsageInfo,
} from "./types.js";

const PROTOCOL_VERSION = 1;

interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    sessionCapabilities?: { resume?: unknown };
  };
  agentInfo?: { name?: string; version?: string };
  authMethods?: { id: string; name?: string }[];
}

interface PromptResult {
  stopReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    totalTokens?: number;
  };
}

interface ActiveTurn {
  sink: EventSink;
  onPermission: PermissionHandler;
  text: string;
  costUsd: number | undefined;
}

export class AcpSession {
  readonly handle: SessionHandle;
  readonly #child: JsonRpcChild;
  #turn: ActiveTurn | undefined;
  /** While a session is being loaded the agent replays history; it must not reach a sink. */
  #replaying = false;

  private constructor(child: JsonRpcChild, handle: SessionHandle) {
    this.#child = child;
    this.handle = handle;
    this.#install();
  }

  /**
   * Start the harness process and open a new session, or resume `resumeSessionId` when the harness
   * can (session/resume, else session/load, else a new session: the caller is told by `resumed`).
   */
  static async open(
    desc: HarnessDescriptor,
    init: SessionInit,
    resumeSessionId?: string,
    onStderr?: (t: string) => void,
  ): Promise<{ session: AcpSession; resumed: "resume" | "load" | "none" }> {
    if (desc.protocol === "codex-app-server") throw new Error("Codex uses CodexSession, not ACP");
    const spawnSpec = desc.spawn(init);
    const child = new JsonRpcChild({
      command: spawnSpec.command,
      args: spawnSpec.args,
      cwd: init.cwd,
      // When the caller built the environment (the node does, without Michel's own secrets), do not add the
      // whole process environment back to it: that would undo the stripping.
      env: init.env ? { ...spawnSpec.env, ...init.env } : { ...process.env, ...spawnSpec.env },
      ...(onStderr ? { onStderr } : {}),
    });
    try {
      const init1 = await child.request<InitializeResult>(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          // v0 advertises no client-side fs or terminal: the harness edits files and runs commands
          // itself, and Michel gates them through permission requests (spike 0.14 revisits this).
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "anybot", version: "0.0.0" },
        },
        60_000,
      );
      if (desc.authMethod) {
        const methods = init1.authMethods ?? [];
        const methodId = desc.authMethod(methods, init);
        if (!methodId) {
          throw new Error(
            `${desc.label} offers no usable sign-in (methods: ${methods.map((m) => m.id).join(", ") || "none"}); log in on the node or set the key in the account's env`,
          );
        }
        await child.request("authenticate", { methodId, _meta: { headless: true } }, 60_000);
      }
      const caps = init1.agentCapabilities ?? {};
      const capabilities: AdapterCapabilities = {
        loadSession: caps.loadSession === true,
        resumeSession: caps.sessionCapabilities?.resume !== undefined,
        images: caps.promptCapabilities?.image === true,
        mcpHttp: caps.mcpCapabilities?.http === true,
        mcpSse: caps.mcpCapabilities?.sse === true,
        ...(init1.agentInfo?.name ? { agentName: init1.agentInfo.name } : {}),
        ...(init1.agentInfo?.version ? { agentVersion: init1.agentInfo.version } : {}),
      };
      const mcpServers = (init.mcpServers ?? []).map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
      }));
      const meta = desc.sessionMeta?.(init);
      let sessionId: string | undefined;
      let resumed: "resume" | "load" | "none" = "none";
      let session: AcpSession | undefined;

      if (resumeSessionId && capabilities.resumeSession) {
        try {
          await child.request(
            "session/resume",
            {
              sessionId: resumeSessionId,
              cwd: init.cwd,
              mcpServers,
              ...(meta ? { _meta: meta } : {}),
            },
            60_000,
          );
          sessionId = resumeSessionId;
          resumed = "resume";
        } catch (e) {
          if (!(e instanceof RpcFailure)) throw e;
        }
      }
      if (!sessionId && resumeSessionId && capabilities.loadSession) {
        // session/load replays the conversation as notifications: swallow them.
        const handle: SessionHandle = {
          sessionId: resumeSessionId,
          harness: desc.id,
          cwd: init.cwd,
          capabilities,
        };
        session = new AcpSession(child, handle);
        session.#replaying = true;
        try {
          await child.request(
            "session/load",
            {
              sessionId: resumeSessionId,
              cwd: init.cwd,
              mcpServers,
              ...(meta ? { _meta: meta } : {}),
            },
            120_000,
          );
          session.#replaying = false;
          return { session, resumed: "load" };
        } catch (e) {
          if (!(e instanceof RpcFailure)) throw e;
          session = undefined;
        }
      }
      if (!sessionId) {
        const r = await child.request<{ sessionId: string }>(
          "session/new",
          { cwd: init.cwd, mcpServers, ...(meta ? { _meta: meta } : {}) },
          120_000,
        );
        sessionId = r.sessionId;
      }
      const handle: SessionHandle = { sessionId, harness: desc.id, cwd: init.cwd, capabilities };
      return { session: new AcpSession(child, handle), resumed };
    } catch (e) {
      child.kill("SIGKILL");
      throw e;
    }
  }

  get exited() {
    return this.#child.exited;
  }

  get closed() {
    return this.#child.closed;
  }

  get pid(): number | undefined {
    return this.#child.proc.pid;
  }

  #install(): void {
    this.#child.onNotification("session/update", (p) => this.#onUpdate(p));
    this.#child.onRequest("session/request_permission", (p) => this.#onPermission(p));
  }

  #emit(e: AdapterEvent): void {
    if (this.#replaying) return;
    this.#turn?.sink(e);
  }

  #onUpdate(params: unknown): void {
    const p = params as { sessionId?: string; update?: Record<string, unknown> };
    if (p.sessionId !== this.handle.sessionId || !p.update) return;
    const u = p.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const c = u.content as { type?: string; text?: string } | undefined;
        if (c?.type === "text" && typeof c.text === "string") {
          if (this.#turn && !this.#replaying) this.#turn.text += c.text;
          this.#emit({
            type: "text_delta",
            text: c.text,
            ...(typeof u.messageId === "string" ? { messageId: u.messageId } : {}),
          });
        }
        break;
      }
      case "agent_thought_chunk": {
        const c = u.content as { type?: string; text?: string } | undefined;
        if (c?.type === "text" && typeof c.text === "string")
          this.#emit({ type: "thought_delta", text: c.text });
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const status = u.status as ToolStatus | undefined;
        this.#emit({
          type: "tool",
          toolCallId: String(u.toolCallId),
          ...(typeof u.title === "string" ? { title: u.title } : {}),
          ...(typeof u.kind === "string" ? { kind: u.kind } : {}),
          ...(status ? { status } : {}),
          ...(u.rawInput !== undefined ? { rawInput: u.rawInput } : {}),
          ...(u.rawOutput !== undefined ? { rawOutput: u.rawOutput } : {}),
        });
        break;
      }
      case "plan": {
        const entries =
          (u.entries as { content: string; status: string; priority?: string }[] | undefined) ?? [];
        this.#emit({ type: "plan", entries });
        break;
      }
      case "usage_update": {
        const cost = (u.cost as { amount?: number } | undefined)?.amount;
        if (this.#turn && typeof cost === "number") this.#turn.costUsd = cost;
        this.#emit({
          type: "usage",
          used: Number(u.used ?? 0),
          size: Number(u.size ?? 0),
          ...(typeof cost === "number" ? { costUsd: cost } : {}),
        });
        break;
      }
      case "session_info_update":
        this.#emit({ type: "info", ...(typeof u.title === "string" ? { title: u.title } : {}) });
        break;
      default:
        break; // available_commands_update, current_mode_update, ...
    }
  }

  async #onPermission(params: unknown): Promise<unknown> {
    const p = params as {
      sessionId: string;
      toolCall: {
        toolCallId: string;
        title?: string;
        kind?: string;
        name?: string;
        rawInput?: unknown;
        content?: unknown;
        _meta?: { claudeCode?: { toolName?: string } };
      };
      options: PermissionOption[];
    };
    const turn = this.#turn;
    if (!turn || p.sessionId !== this.handle.sessionId)
      return { outcome: { outcome: "cancelled" } };
    const tc = p.toolCall;
    const req: PermissionRequest = {
      requestId: `${p.sessionId}:${tc.toolCallId}`,
      sessionId: p.sessionId,
      toolCallId: tc.toolCallId,
      ...(tc.title !== undefined ? { title: tc.title } : {}),
      ...(tc.kind !== undefined ? { kind: tc.kind } : {}),
      toolName: tc.name ?? tc._meta?.claudeCode?.toolName ?? tc.kind ?? "tool",
      ...(tc.rawInput !== undefined ? { rawInput: tc.rawInput } : {}),
      ...(tc.content !== undefined ? { content: tc.content } : {}),
      options: p.options ?? [],
    };
    let decision: PermissionDecision;
    try {
      decision = await turn.onPermission(req);
    } catch {
      decision = { outcome: "cancelled" };
    }
    return { outcome: decision };
  }

  /** Send one prompt and wait for the turn to end. */
  async prompt(
    input: TurnInput,
    sink: EventSink,
    onPermission: PermissionHandler,
  ): Promise<TurnResult> {
    if (this.#turn) throw new Error("a turn is already running on this session");
    const turn: ActiveTurn = { sink, onPermission, text: "", costUsd: undefined };
    this.#turn = turn;
    try {
      const r = await this.#child.request<PromptResult>("session/prompt", {
        sessionId: this.handle.sessionId,
        prompt: [{ type: "text", text: input.text }],
      });
      const u = r.usage;
      const usage: UsageInfo | undefined = u
        ? {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            cachedReadTokens: u.cachedReadTokens ?? 0,
            cachedWriteTokens: u.cachedWriteTokens ?? 0,
            totalTokens: u.totalTokens ?? 0,
            ...(turn.costUsd !== undefined ? { costUsd: turn.costUsd } : {}),
          }
        : undefined;
      return { stopReason: r.stopReason, text: turn.text, ...(usage ? { usage } : {}) };
    } finally {
      this.#turn = undefined;
    }
  }

  /** Ask the harness to stop the current turn. */
  cancel(): void {
    this.#child.notify("session/cancel", { sessionId: this.handle.sessionId });
  }

  async setMode(modeId: string): Promise<void> {
    await this.#child.request(
      "session/set_mode",
      { sessionId: this.handle.sessionId, modeId },
      30_000,
    );
  }

  /** Stop the harness process. The session id stays valid for a later resume. */
  async close(): Promise<void> {
    this.#child.kill("SIGTERM");
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 5_000);
    await this.#child.closed;
    clearTimeout(timer);
  }

  kill(): void {
    this.#child.kill("SIGKILL");
  }
}
