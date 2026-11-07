import { type Backend, Unauthorized, Unavailable, type WatchEvent } from "@anyagent/backend";
import { type AgentMap, startAgentDiscovery, type TrackedAgent } from "./agents.js";
import type { DeliveryClient } from "./delivery.js";
import { deliverAndCommit } from "./delivery.js";
import { logGateway } from "./log.js";
import { pipelineEvent, sourceForChat } from "./pipeline.js";
import { maybeRotate, type RotationClient } from "./rotation.js";
import type { GatewayState } from "./state.js";

export interface OrgSupervisorOpts {
  orgId: string;
  spaceId: string;
  backend: Backend;
  state: GatewayState;
  delivery: DeliveryClient;
  rotation?: RotationClient;
  nodeQueue: string;
  ownerIds: string[];
  workflowType?: string;
  taskQueue?: string;
  rotateAfterAccepted?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Cap backoff in tests. */
  maxBackoffMs?: number;
  /** Initial backoff after Unavailable (tests). */
  initialBackoffMs?: number;
}

export interface OrgSupervisor {
  readonly orgId: string;
  readonly stopped: boolean;
  readonly stopReason: string | undefined;
  agents: AgentMap;
  stop: () => Promise<void>;
  /** Process one watch event (tests / resume catch-up). */
  handleChatEvent: (agent: TrackedAgent, event: WatchEvent) => Promise<void>;
}

/**
 * One supervisor per org. Unavailable → retry with backoff; Unauthorized → stop this org only.
 */
export function startOrgSupervisor(opts: OrgSupervisorOpts): OrgSupervisor {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const initialBackoff = opts.initialBackoffMs ?? 500;
  let stopped = false;
  let stopReason: string | undefined;
  let discoveryStop: (() => Promise<void>) | undefined;
  let rotationTimer: ReturnType<typeof setInterval> | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  const chatWatchers = new Map<string, AbortController>();
  let agents: AgentMap = new Map();
  let selfId = "";

  const api: OrgSupervisor = {
    orgId: opts.orgId,
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    get agents() {
      return agents;
    },
    stop: async () => {
      stopped = true;
      if (rotationTimer) clearInterval(rotationTimer);
      if (pruneTimer) clearInterval(pruneTimer);
      for (const ac of chatWatchers.values()) ac.abort();
      chatWatchers.clear();
      await discoveryStop?.();
    },
    handleChatEvent: async (agent, event) => {
      await handleEvent(agent, event);
    },
  };

  async function rotateAll(): Promise<void> {
    if (!opts.rotation || stopped) return;
    for (const agent of agents.values()) {
      await maybeRotate({
        client: opts.rotation,
        orgId: opts.orgId,
        spaceId: opts.spaceId,
        agentId: agent.agentId,
        ...(opts.rotateAfterAccepted !== undefined
          ? { rotateAfterAccepted: opts.rotateAfterAccepted }
          : {}),
      });
    }
  }

  async function handleEvent(agent: TrackedAgent, event: WatchEvent): Promise<void> {
    const outcome = pipelineEvent({
      event,
      agent: { agentId: agent.agentId, spec: agent.spec },
      selfId,
      ownerIds: opts.ownerIds,
      isDelivered: (key) => opts.state.isDelivered(opts.spaceId, key),
    });
    if (outcome.action === "drop") {
      if (outcome.reason === "author-not-allowed") {
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          agent: agent.agentId,
          outcome: "ignored: author not allowed",
        });
      }
      // Advance cursor for non-deliverable events that still carry one (e.g. removed).
      if (event.kind === "chat" && event.cursor) {
        opts.state.commit(opts.spaceId, sourceForChat(agent.chatId), event.cursor);
      }
      return;
    }
    const deliverOpts: Parameters<typeof deliverAndCommit>[0] = {
      state: opts.state,
      client: opts.delivery,
      target: {
        orgId: opts.orgId,
        spaceId: opts.spaceId,
        agentId: agent.agentId,
        nodeQueue: opts.nodeQueue,
        ...(opts.workflowType ? { workflowType: opts.workflowType } : {}),
        ...(opts.taskQueue ? { taskQueue: opts.taskQueue } : {}),
      },
      input: outcome.input,
      chatId: agent.chatId,
      sleep,
    };
    if (outcome.cursor !== undefined) deliverOpts.cursor = outcome.cursor;
    if (event.kind === "chat" && event.message?.createdAt) {
      deliverOpts.eventCreatedAt = event.message.createdAt;
    }
    await deliverAndCommit(deliverOpts);
    if (opts.rotation) {
      await maybeRotate({
        client: opts.rotation,
        orgId: opts.orgId,
        spaceId: opts.spaceId,
        agentId: agent.agentId,
        ...(opts.rotateAfterAccepted !== undefined
          ? { rotateAfterAccepted: opts.rotateAfterAccepted }
          : {}),
      });
    }
  }

  function syncChatWatchers(next: AgentMap): void {
    agents = next;
    const wanted = new Set([...next.values()].map((a) => a.chatId));
    for (const [chatId, ac] of chatWatchers) {
      if (!wanted.has(chatId)) {
        ac.abort();
        chatWatchers.delete(chatId);
      }
    }
    for (const agent of next.values()) {
      if (chatWatchers.has(agent.chatId)) continue;
      const ac = new AbortController();
      chatWatchers.set(agent.chatId, ac);
      void runChatWatch(agent, ac.signal);
    }
  }

  async function runChatWatch(agent: TrackedAgent, signal: AbortSignal): Promise<void> {
    let backoff = initialBackoff;
    while (!stopped && !signal.aborted) {
      try {
        const after = opts.state.getCursor(opts.spaceId, sourceForChat(agent.chatId));
        const watchOpts = signal
          ? { signal, ...(after !== undefined ? { after } : {}) }
          : after !== undefined
            ? { after }
            : {};
        for await (const event of opts.backend.events.watch(
          { kind: "chat", chatId: agent.chatId },
          watchOpts,
        )) {
          if (stopped || signal.aborted) return;
          if (event.kind === "ready") continue;
          // Re-resolve agent in case map changed
          const current = agents.get(agent.agentId);
          if (!current || current.chatId !== agent.chatId) return;
          try {
            await handleEvent(current, event);
          } catch (err) {
            // Permanent delivery failure after retries: advance cursor so one bad
            // message cannot stall the chat forever. Stream/transport errors rethrow.
            const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
            const transient =
              err instanceof Unavailable ||
              /Unavailable|ECONNRESET|socket|network/i.test(msg);
            if (transient) throw err;
            logGateway({
              org: opts.orgId,
              space: opts.spaceId,
              agent: current.agentId,
              outcome: "chat-event-skipped",
              detail: msg.slice(0, 200),
            });
            if (event.kind === "chat" && event.cursor) {
              opts.state.commit(opts.spaceId, sourceForChat(agent.chatId), event.cursor);
            }
            continue;
          }
        }
        if (stopped || signal.aborted) return;
        // Clean stream end: delay before re-watch (avoid hot loop).
        await sleep(Math.max(backoff, initialBackoff));
        backoff = Math.min(Math.max(backoff, initialBackoff) * 2, maxBackoff);
      } catch (err) {
        if (signal.aborted || stopped) return;
        if (err instanceof Unauthorized) {
          stopped = true;
          stopReason = `Unauthorized for org ${opts.orgId}: ${err.message}`;
          logGateway({
            org: opts.orgId,
            space: opts.spaceId,
            outcome: "supervisor-stopped",
            detail: stopReason,
          });
          await api.stop();
          return;
        }
        if (err instanceof Unavailable) {
          logGateway({
            org: opts.orgId,
            space: opts.spaceId,
            outcome: "backend-unavailable",
            detail: err.message.slice(0, 200),
          });
          await sleep(Math.max(backoff, 1));
          backoff = Math.min(backoff * 2, maxBackoff);
          continue;
        }
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "chat-watch-error",
          detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        await sleep(Math.max(backoff, 1));
        backoff = Math.min(backoff * 2, maxBackoff);
      }
    }
  }

  void (async () => {
    try {
      selfId = (await opts.backend.identity.self()).id;
      const discovery = await startAgentDiscovery({
        backend: opts.backend,
        orgId: opts.orgId,
        spaceId: opts.spaceId,
        onChange: syncChatWatchers,
      });
      discoveryStop = discovery.stop;
      syncChatWatchers(discovery.agents);
      // ADR 0011 7-day retention: prune once at start and daily.
      try {
        opts.state.pruneDelivered();
      } catch {
        // ignore prune errors at start
      }
      pruneTimer = setInterval(() => {
        try {
          opts.state.pruneDelivered();
        } catch {
          // ignore
        }
      }, 24 * 60 * 60 * 1000);
      if (opts.rotation) {
        rotationTimer = setInterval(() => {
          void rotateAll();
        }, 30_000);
      }
    } catch (err) {
      if (err instanceof Unauthorized) {
        stopped = true;
        stopReason = `Unauthorized for org ${opts.orgId}: ${err.message}`;
        logGateway({
          org: opts.orgId,
          space: opts.spaceId,
          outcome: "supervisor-stopped",
          detail: stopReason,
        });
        return;
      }
      throw err;
    }
  })();

  return api;
}

export interface MultiOrgGateway {
  supervisors: Map<string, OrgSupervisor>;
  stop: () => Promise<void>;
}

export function startGateway(opts: {
  orgs: Array<{
    orgId: string;
    spaceId: string;
    backend: Backend;
    ownerIds: string[];
    nodeQueue: string;
  }>;
  state: GatewayState;
  delivery: DeliveryClient;
  rotation?: RotationClient;
  workflowType?: string;
  taskQueue?: string;
  rotateAfterAccepted?: number;
  sleep?: (ms: number) => Promise<void>;
  maxBackoffMs?: number;
  initialBackoffMs?: number;
}): MultiOrgGateway {
  const supervisors = new Map<string, OrgSupervisor>();
  for (const org of opts.orgs) {
    const s = startOrgSupervisor({
      orgId: org.orgId,
      spaceId: org.spaceId,
      backend: org.backend,
      ownerIds: org.ownerIds,
      nodeQueue: org.nodeQueue,
      state: opts.state,
      delivery: opts.delivery,
      ...(opts.rotation ? { rotation: opts.rotation } : {}),
      ...(opts.workflowType ? { workflowType: opts.workflowType } : {}),
      ...(opts.taskQueue ? { taskQueue: opts.taskQueue } : {}),
      ...(opts.rotateAfterAccepted !== undefined
        ? { rotateAfterAccepted: opts.rotateAfterAccepted }
        : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.maxBackoffMs !== undefined ? { maxBackoffMs: opts.maxBackoffMs } : {}),
      ...(opts.initialBackoffMs !== undefined ? { initialBackoffMs: opts.initialBackoffMs } : {}),
    });
    supervisors.set(org.orgId, s);
  }
  return {
    supervisors,
    stop: async () => {
      await Promise.all([...supervisors.values()].map((s) => s.stop()));
    },
  };
}
