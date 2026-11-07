import type {
  Backend,
  Capability,
  FieldValue,
  PostInput,
  Scalar,
  SchemaAdmin,
  TypeDef,
  WatchEvent,
  WatchSpec,
} from "@anyagent/backend";
import { HeartClient } from "./client.js";
import { type HeartMessage, type HeartObject, mapMessage, mapObject, mapRole } from "./mapping.js";
import { parseSse } from "./sse.js";

export interface AnytypeAdapterOptions {
  url: string;
  apiKey: string;
  spaceId: string;
  /** Capabilities the live run proved; mock declares a full set. */
  capabilities?: Capability[];
  /** false until spike 002 live suite passes. */
  verified?: boolean;
  fetchImpl?: typeof fetch;
}

export interface AnytypeAdapterMeta {
  verified: boolean;
  spaceId: string;
}

/**
 * Anytype (anytype-heart via `anytype serve`) backend adapter.
 * Live behaviour is unmarked until spike 002; CI uses mock-heart.
 */
export class AnytypeAdapter implements Backend, SchemaAdmin {
  readonly name = "anytype";
  readonly capabilities: ReadonlySet<Capability>;
  readonly meta: AnytypeAdapterMeta;
  private readonly client: HeartClient;
  private readonly spaceId: string;

  constructor(opts: AnytypeAdapterOptions) {
    const clientOpts: ConstructorParameters<typeof HeartClient>[0] = {
      baseUrl: opts.url,
      apiKey: opts.apiKey,
    };
    if (opts.fetchImpl) clientOpts.fetchImpl = opts.fetchImpl;
    this.client = new HeartClient(clientOpts);
    this.spaceId = opts.spaceId;
    this.capabilities = new Set(
      opts.capabilities ?? [
        "resume-cursor",
        "removal-resume",
        "field-versions",
        "roles",
        "agent-envelope",
      ],
    );
    this.meta = { verified: opts.verified ?? false, spaceId: opts.spaceId };
  }

  private space(path: string): string {
    return `/v2/spaces/${this.spaceId}${path}`;
  }

  async ensureSchema(defs: TypeDef[]): Promise<void> {
    await this.client.request("POST", this.space("/schema/ensure"), { body: { defs } });
  }

  readonly identity = {
    self: async () => {
      const r = await this.client.request<{ id: string }>("GET", "/v2/auth/whoami");
      return { id: r.id };
    },
    roleOf: async (participantId: string) => {
      const r = await this.client.request<{ role?: string }>(
        "GET",
        this.space(`/members/${encodeURIComponent(participantId)}`),
      );
      return mapRole(r.role);
    },
  };

  readonly org = {
    list: async (type: string, where: Record<string, Scalar> = {}) => {
      const r = await this.client.request<{ objects: HeartObject[] }>(
        "POST",
        this.space("/objects/list"),
        {
          body: { type, where },
        },
      );
      return r.objects.map((o) => mapObject(o, false));
    },
    get: async (id: string) => {
      const r = await this.client.request<HeartObject | { missing: true }>(
        "GET",
        this.space(`/objects/${encodeURIComponent(id)}`),
      );
      if ("missing" in r && r.missing) return undefined;
      return mapObject(r as HeartObject, true);
    },
  };

  readonly objects = {
    create: async (
      type: string,
      input: { name: string; fields?: Record<string, FieldValue>; body?: string },
    ) => {
      const r = await this.client.request<HeartObject>("POST", this.space("/objects"), {
        body: { type, ...input },
      });
      return mapObject(r, true);
    },
    update: async (
      id: string,
      patch: Record<string, FieldValue>,
      opts: { expect?: Record<string, string> } = {},
    ) => {
      const r = await this.client.request<HeartObject>(
        "PATCH",
        this.space(`/objects/${encodeURIComponent(id)}`),
        { body: { patch, expect: opts.expect } },
      );
      return mapObject(r, true);
    },
  };

  readonly chat = {
    general: async () => {
      const r = await this.client.request<{ id: string }>("GET", this.space("/chats/general"));
      return r.id;
    },
    create: async (input: { name: string }) => {
      const r = await this.client.request<{ id: string }>("POST", this.space("/chats"), {
        body: input,
      });
      return r.id;
    },
    post: async (chatId: string, input: PostInput) => {
      const r = await this.client.request<HeartMessage>(
        "POST",
        this.space(`/chats/${encodeURIComponent(chatId)}/messages`),
        { body: input },
      );
      return mapMessage(r);
    },
    edit: async (chatId: string, messageId: string, text: string) => {
      const r = await this.client.request<HeartMessage>(
        "PATCH",
        this.space(
          `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
        ),
        { body: { text } },
      );
      return mapMessage(r);
    },
    react: async (chatId: string, messageId: string, emoji: string, on: boolean) => {
      const r = await this.client.request<HeartMessage>(
        "POST",
        this.space(
          `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        ),
        { body: { emoji, on } },
      );
      return mapMessage(r);
    },
    remove: async (chatId: string, messageId: string) => {
      await this.client.request(
        "DELETE",
        this.space(
          `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
        ),
      );
    },
    get: async (chatId: string, messageId: string) => {
      const r = await this.client.request<HeartMessage | { missing: true }>(
        "GET",
        this.space(
          `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
        ),
      );
      if ("missing" in r && r.missing) return undefined;
      return mapMessage(r as HeartMessage);
    },
    history: async (chatId: string, opts: { limit?: number } = {}) => {
      const q = opts.limit !== undefined ? `?limit=${opts.limit}` : "";
      const r = await this.client.request<{ messages: HeartMessage[] }>(
        "GET",
        this.space(`/chats/${encodeURIComponent(chatId)}/messages${q}`),
      );
      return r.messages.map(mapMessage);
    },
  };

  readonly events = {
    watch: (
      spec: WatchSpec,
      opts: { after?: string; signal?: AbortSignal } = {},
    ): AsyncIterable<WatchEvent> => this.watch(spec, opts),
  };

  private async *watch(
    spec: WatchSpec,
    opts: { after?: string; signal?: AbortSignal },
  ): AsyncGenerator<WatchEvent> {
    const q =
      spec.kind === "chat"
        ? `kind=chat&chatId=${encodeURIComponent(spec.chatId)}`
        : `kind=objects&type=${encodeURIComponent(spec.type)}&where=${encodeURIComponent(JSON.stringify(spec.where ?? {}))}`;
    const after = opts.after ? `&after=${encodeURIComponent(opts.after)}` : "";
    // Chat watch with no cursor: emit nothing before ready (port contract).
    const streamOpts: { headers?: Record<string, string>; signal?: AbortSignal } = {};
    if (opts.signal) streamOpts.signal = opts.signal;
    if (opts.after) streamOpts.headers = { "Last-Event-ID": opts.after };
    const res = await this.client.stream(
      `${this.space(`/events/stream?${q}${after}`)}`,
      streamOpts,
    );
    if (!res.body) return;
    let sawReady = false;
    const pending: WatchEvent[] = [];
    for await (const frame of parseSse(res.body)) {
      if (opts.signal?.aborted) return;
      if (frame.kind !== "event") continue;
      if (frame.event.type === "resync_required") {
        // Re-read recent history and emit upsert for messages newer than cursor (chat only).
        if (spec.kind === "chat" && opts.after) {
          const hist = await this.chat.history(spec.chatId, { limit: 100 });
          for (const m of hist) {
            if (m.cursor && opts.after && BigInt(m.cursor) <= BigInt(opts.after)) continue;
            yield { kind: "chat", op: "upsert", id: m.id, message: m, cursor: m.cursor };
          }
        }
        continue;
      }
      const ev = JSON.parse(frame.event.data) as WatchEvent;
      if (ev.kind === "ready") {
        for (const p of pending) yield p;
        pending.length = 0;
        sawReady = true;
        yield ev;
        continue;
      }
      if (!sawReady) {
        // Objects watch: initial upserts before ready. Chat with no after: must not emit before ready.
        if (spec.kind === "chat" && opts.after === undefined) continue;
        pending.push(ev);
        continue;
      }
      yield ev;
    }
  }
}

export function createAnytypeAdapter(opts: AnytypeAdapterOptions): AnytypeAdapter {
  return new AnytypeAdapter(opts);
}
