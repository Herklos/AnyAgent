import { JsonRpcChild } from "../../src/jsonrpc-child.ts";
import type { CodexApproval } from "./codex-recovery.ts";

export interface SpikeTurn {
  id: string;
  status: string;
  items: { id: string; type: string; status?: string; command?: string }[];
}

/** A probe, not a Michel adapter. Defaults to declining every approval. */
export class CodexSpikeClient {
  readonly rpc: JsonRpcChild;
  readonly approvals: CodexApproval[] = [];
  readonly turns: SpikeTurn[] = [];
  readonly deltas: string[] = [];
  onApproval: (request: CodexApproval) => Promise<{ decision: "accept" | "decline" | "cancel" }> =
    async () => ({
      decision: "decline",
    });

  constructor(cwd: string) {
    this.rpc = new JsonRpcChild({
      command: "codex",
      args: ["app-server", "-c", "mcp_servers={}", "-c", "hooks={}"],
      cwd,
      env: process.env,
    });
    for (const method of [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ] as const) {
      this.rpc.onRequest(method, async (params) => {
        const request: CodexApproval = { method, params: params as CodexApproval["params"] };
        this.approvals.push(request);
        return this.onApproval(request);
      });
    }
    this.rpc.onNotification("turn/completed", (params) =>
      this.turns.push((params as { turn: SpikeTurn }).turn),
    );
    this.rpc.onNotification("item/agentMessage/delta", (params) =>
      this.deltas.push((params as { delta: string }).delta),
    );
  }

  async initialize(): Promise<void> {
    await this.rpc.request(
      "initialize",
      {
        clientInfo: { name: "michel-recovery-spike", version: "0.0.0" },
      },
      30_000,
    );
    this.rpc.notify("initialized");
  }

  async start(cwd: string): Promise<string> {
    const result = await this.rpc.request<{ thread: { id: string } }>(
      "thread/start",
      {
        cwd,
        ephemeral: false,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        developerInstructions:
          "This is an integration test. Follow the exact command requested; do not use other tools, MCP servers, subagents, or skills. If denied, stop. Never retry an alternative command.",
      },
      30_000,
    );
    return result.thread.id;
  }

  async prompt(threadId: string, text: string): Promise<string> {
    const result = await this.rpc.request<{ turn: SpikeTurn }>(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
      },
      30_000,
    );
    return result.turn.id;
  }

  async resume(
    threadId: string,
  ): Promise<{ thread: { id: string; status: { type: string }; turns: SpikeTurn[] } }> {
    return this.rpc.request(
      "thread/resume",
      { threadId, approvalPolicy: "untrusted", approvalsReviewer: "user" },
      30_000,
    );
  }

  async history(threadId: string): Promise<SpikeTurn[]> {
    const turns: SpikeTurn[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: SpikeTurn[]; nextCursor: string | null } = await this.rpc.request(
        "thread/turns/list",
        {
          threadId,
          itemsView: "full",
          limit: 50,
          ...(cursor ? { cursor } : {}),
        },
        30_000,
      );
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return turns;
  }

  async close(): Promise<void> {
    this.rpc.kill("SIGKILL");
    await this.rpc.closed;
  }
}

export async function waitUntil(
  predicate: () => boolean,
  label: string,
  rpc: JsonRpcChild,
  timeout = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (rpc.exited) throw rpc.exited;
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}. ${rpc.stderrTail.slice(-500)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
