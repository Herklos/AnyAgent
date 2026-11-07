import { listAgents } from "@anyagent/admin";
import type { Backend, WatchEvent } from "@anyagent/backend";
import { type AgentSpec, parseAgentSpec } from "@anyagent/core";
import { logGateway } from "./log.js";

export interface TrackedAgent {
  agentId: string;
  spec: AgentSpec;
  chatId: string;
}

export type AgentMap = Map<string, TrackedAgent>;

export interface AgentDiscovery {
  agents: AgentMap;
  /** chatId → agentId */
  chatIndex: Map<string, string>;
  stop: () => Promise<void>;
}

/**
 * List agents then watch aa_agent objects. Invalid specs are logged once per change.
 */
export async function startAgentDiscovery(opts: {
  backend: Backend;
  orgId: string;
  spaceId: string;
  onChange?: (agents: AgentMap) => void;
}): Promise<AgentDiscovery> {
  const agents: AgentMap = new Map();
  const chatIndex = new Map<string, string>();
  const loggedInvalid = new Set<string>();
  const ac = new AbortController();

  const applyList = async () => {
    const listed = await listAgents(opts.backend);
    const seen = new Set<string>();
    for (const row of listed) {
      seen.add(row.id);
      if (row.error || !row.spec) {
        if (!loggedInvalid.has(row.id)) {
          logGateway({
            org: opts.orgId,
            space: opts.spaceId,
            agent: row.id,
            outcome: "invalid-spec",
            detail: row.error ?? "missing spec",
          });
          loggedInvalid.add(row.id);
        }
        const prev = agents.get(row.id);
        if (prev) {
          chatIndex.delete(prev.chatId);
          agents.delete(row.id);
        }
        continue;
      }
      loggedInvalid.delete(row.id);
      const tracked: TrackedAgent = {
        agentId: row.id,
        spec: row.spec,
        chatId: row.spec.chatId,
      };
      const prev = agents.get(row.id);
      if (prev) chatIndex.delete(prev.chatId);
      agents.set(row.id, tracked);
      chatIndex.set(tracked.chatId, row.id);
    }
    for (const id of [...agents.keys()]) {
      if (!seen.has(id)) {
        const prev = agents.get(id);
        if (prev) chatIndex.delete(prev.chatId);
        agents.delete(id);
      }
    }
    opts.onChange?.(agents);
  };

  await applyList();

  // Reconnect on stream end or backend error until aborted (comment previously claimed
  // the supervisor restarted us; it does not).
  const watchLoop = (async () => {
    let backoff = 200;
    while (!ac.signal.aborted) {
      try {
        for await (const ev of opts.backend.events.watch(
          { kind: "objects", type: "aa_agent" },
          { signal: ac.signal },
        )) {
          if (ev.kind === "ready") continue;
          await handleObjectEvent(ev);
          backoff = 200;
        }
        if (ac.signal.aborted) return;
        // Clean end: refresh list then reconnect with a small delay (no hot loop).
        await applyList();
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      } catch {
        if (ac.signal.aborted) return;
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "agent-discovery-reconnect",
          detail: `backoff ${backoff}ms`,
        });
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10_000);
        try {
          await applyList();
        } catch {
          // keep trying on next loop
        }
      }
    }
  })();

  async function handleObjectEvent(ev: WatchEvent): Promise<void> {
    if (ev.kind !== "object") return;
    if (ev.op === "removed") {
      const prev = agents.get(ev.id);
      if (prev) chatIndex.delete(prev.chatId);
      agents.delete(ev.id);
      opts.onChange?.(agents);
      return;
    }
    const obj = ev.object ?? (await opts.backend.org.get(ev.id));
    if (!obj) return;
    const parsed = parseAgentSpec(obj, obj.body);
    if (!parsed.ok || !parsed.spec.chatId) {
      if (!loggedInvalid.has(ev.id)) {
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          agent: ev.id,
          outcome: "invalid-spec",
          detail: !parsed.ok
            ? parsed.errors.map((e) => `${e.field}:${e.message}`).join(",")
            : "aa_chat:required",
        });
        loggedInvalid.add(ev.id);
      }
      const prev = agents.get(ev.id);
      if (prev) {
        chatIndex.delete(prev.chatId);
        agents.delete(ev.id);
        opts.onChange?.(agents);
      }
      return;
    }
    loggedInvalid.delete(ev.id);
    const prev = agents.get(ev.id);
    if (prev) chatIndex.delete(prev.chatId);
    agents.set(ev.id, {
      agentId: ev.id,
      spec: parsed.spec,
      chatId: parsed.spec.chatId,
    });
    chatIndex.set(parsed.spec.chatId, ev.id);
    opts.onChange?.(agents);
  }

  return {
    agents,
    chatIndex,
    stop: async () => {
      ac.abort();
      await watchLoop.catch(() => undefined);
    },
  };
}
