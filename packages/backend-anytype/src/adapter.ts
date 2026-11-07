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
  /**
   * Capabilities the **live** run proved. Default is empty: WP1 step 5 says
   * declare only what a live run shows. Tests against mock-heart must pass
   * the capabilities the mock supports.
   */
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
 * Routes follow docs/research/anytype-api.md (heart@09bd4b5). Live behaviour
 * remains unverified until spike 002; CI uses mock-heart with the same shapes.
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
    this.capabilities = new Set(opts.capabilities ?? []);
    this.meta = { verified: opts.verified ?? false, spaceId: opts.spaceId };
  }

  private space(path: string): string {
    return `/v2/spaces/${this.spaceId}${path}`;
  }

  /**
   * Idempotent schema ensure via documented `/types` and `/properties`
   * (there is no `/schema/ensure`). UNVERIFIED against live heart until spike 002.
   */
  async ensureSchema(defs: TypeDef[]): Promise<void> {
    const listed = await this.client.request<{ types?: TypeDef[] }>("GET", this.space("/types"));
    const existing = new Map((listed.types ?? []).map((t) => [t.key, t]));
    for (const def of defs) {
      const cur = existing.get(def.key);
      if (!cur) {
        await this.client.request("POST", this.space("/types"), {
          body: { key: def.key, label: def.label, fields: def.fields, chat: def.chat },
        });
        for (const f of def.fields) {
          // UNVERIFIED: whether properties are created separately or inline with the type.
          await this.client.request("POST", this.space("/properties"), {
            body: {
              type_key: def.key,
              key: f.key,
              label: f.label,
              format: f.format,
              ...(f.options ? { options: f.options } : {}),
            },
          });
        }
        continue;
      }
      const have = new Set(cur.fields?.map((f) => f.key) ?? []);
      for (const f of def.fields) {
        if (have.has(f.key)) continue;
        await this.client.request("POST", this.space("/properties"), {
          body: {
            type_key: def.key,
            key: f.key,
            label: f.label,
            format: f.format,
            ...(f.options ? { options: f.options } : {}),
          },
        });
      }
    }
  }

  readonly identity = {
    /**
     * The participant this connection writes as (message authors are participants).
     * Uses `GET …/members/me`, not `whoami` (key identity).
     */
    self: async () => {
      const r = await this.client.request<{ id: string }>("GET", this.space("/members/me"));
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
      // Documented list path: POST /v2/spaces/{s}/search
      const r = await this.client.request<{ objects: HeartObject[] }>(
        "POST",
        this.space("/search"),
        { body: { type, where } },
      );
      return r.objects.map((o) => mapObject(o, false));
    },
    get: async (id: string) => {
      try {
        const r = await this.client.request<HeartObject>(
          "GET",
          this.space(`/objects/${encodeURIComponent(id)}`),
        );
        return mapObject(r, true);
      } catch (err) {
        if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
          return undefined;
        }
        throw err;
      }
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
    /**
     * The space's general chat. UNVERIFIED: heart has no `/chats/general`;
     * we list chats and pick/create one named "general".
     */
    general: async () => {
      const r = await this.client.request<{ chats: { id: string; name: string }[] }>(
        "GET",
        this.space("/chats"),
      );
      const found = (r.chats ?? []).find((c) => c.name.toLowerCase() === "general");
      if (found) return found.id;
      const created = await this.client.request<{ id: string }>("POST", this.space("/chats"), {
        body: { name: "general" },
      });
      return created.id;
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
    /**
     * Reaction endpoint is a **toggle**. Port wants idempotent `on`; we read
     * current state (`?reactions=full`) and toggle only when needed.
     * UNVERIFIED body shape `{ emoji }` until spike 002.
     */
    react: async (chatId: string, messageId: string, emoji: string, on: boolean) => {
      const me = (await this.identity.self()).id;
      const current = await this.chat.get(chatId, messageId);
      if (!current) {
        // Force a NotFound from the toggle path.
        await this.client.request(
          "POST",
          this.space(
            `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
          ),
          { body: { emoji } },
        );
        throw new Error(`message ${messageId} not found after react`);
      }
      const has = (current.reactions[emoji] ?? []).includes(me);
      if (has === on) return current;
      const r = await this.client.request<HeartMessage>(
        "POST",
        this.space(
          `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        ),
        { body: { emoji } },
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
      try {
        const r = await this.client.request<HeartMessage>(
          "GET",
          this.space(
            `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?reactions=full`,
          ),
        );
        return mapMessage(r);
      } catch (err) {
        if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
          return undefined;
        }
        throw err;
      }
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
    /**
     * Ends when `signal` aborts. With `after`, replays what changed since that
     * cursor, then `ready`, then live. Reconnects by itself from the last event
     * id (`Last-Event-ID`); on `resync_required` re-reads recent history.
     */
    watch: (
      spec: WatchSpec,
      opts: { after?: string; signal?: AbortSignal } = {},
    ): AsyncIterable<WatchEvent> => this.watch(spec, opts),
  };

  private async *watch(
    spec: WatchSpec,
    opts: { after?: string; signal?: AbortSignal },
  ): AsyncGenerator<WatchEvent> {
    let lastEventId = opts.after;
    /** Message/object ids already yielded (dedupe across reconnect). */
    const seen = new Set<string>();
    let readyEmitted = false;
    let backoffMs = 50;

    while (!opts.signal?.aborted) {
      try {
        if (spec.kind === "chat") {
          for await (const ev of this.watchChat(spec.chatId, lastEventId, opts.signal, (id) => {
            lastEventId = id;
          })) {
            if (opts.signal?.aborted) return;
            if (ev.kind === "ready") {
              if (!readyEmitted) {
                readyEmitted = true;
                yield ev;
              }
              continue;
            }
            if (ev.kind === "chat") {
              const key = `${ev.op}:${ev.id}:${ev.cursor ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              if (ev.cursor) lastEventId = ev.cursor;
              yield ev;
            }
          }
        } else {
          for await (const ev of this.watchObjects(spec, opts.signal, lastEventId)) {
            if (opts.signal?.aborted) return;
            if (ev.kind === "ready") {
              if (!readyEmitted) {
                readyEmitted = true;
                yield ev;
              }
              continue;
            }
            if (ev.kind === "object") {
              const key = `${ev.op}:${ev.id}:${ev.cursor ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              if (ev.cursor) lastEventId = ev.cursor;
              yield ev;
            }
          }
        }
      } catch {
        if (opts.signal?.aborted) return;
        // fall through to reconnect
      }
      if (opts.signal?.aborted) return;
      // Stream ended without abort → reconnect from lastEventId.
      await sleep(backoffMs, opts.signal);
      backoffMs = Math.min(backoffMs * 2, 2_000);
    }
  }

  private async *watchChat(
    chatId: string,
    after: string | undefined,
    signal: AbortSignal | undefined,
    onCursor: (id: string) => void,
  ): AsyncGenerator<WatchEvent> {
    const headers: Record<string, string> = {};
    if (after) headers["Last-Event-ID"] = after;
    const streamOpts: { headers?: Record<string, string>; signal?: AbortSignal } = { headers };
    if (signal) streamOpts.signal = signal;
    const res = await this.client.stream(
      this.space(`/chats/${encodeURIComponent(chatId)}/messages/stream`),
      streamOpts,
    );
    if (!res.body) return;

    let sawCatchupCursor = after === undefined ? false : false;
    // Opening window then trailing id-only cursor, then live (research note).
    let inOpeningWindow = true;
    const pending: WatchEvent[] = [];

    for await (const frame of parseSse(res.body)) {
      if (signal?.aborted) return;
      if (frame.kind === "comment") continue;
      if (frame.kind === "cursor") {
        onCursor(frame.id);
        // Trailing catch-up cursor → emit ready, then live.
        if (inOpeningWindow) {
          inOpeningWindow = false;
          for (const p of pending) yield p;
          pending.length = 0;
          yield { kind: "ready" };
          sawCatchupCursor = true;
        }
        continue;
      }
      if (frame.kind !== "event") continue;
      const type = frame.event.type;
      if (type === "resync_required") {
        // Opaque cursors: re-read history and upsert messages after the last
        // **message id** we have seen (history order), not by comparing cursors.
        const hist = await this.chat.history(chatId, { limit: 100 });
        let past = after === undefined;
        for (const m of hist) {
          // `after` on resync is treated as a message id watermark when it matches
          // an id; otherwise emit the whole window as upsert (safe over-delivery).
          if (!past) {
            if (m.id === after || m.cursor === after) {
              past = true;
              continue;
            }
            continue;
          }
          const ev: WatchEvent = {
            kind: "chat",
            op: "upsert",
            id: m.id,
            message: m,
            cursor: m.cursor,
          };
          if (inOpeningWindow) pending.push(ev);
          else yield ev;
          if (m.cursor) onCursor(m.cursor);
        }
        continue;
      }
      const data = JSON.parse(frame.event.data) as {
        type?: string;
        message?: HeartMessage;
        message_id?: string;
      };
      let mapped: WatchEvent | undefined;
      if (type === "message_added" && data.message) {
        const message = mapMessage(normalizeHeartMessage(data.message, chatId));
        mapped = {
          kind: "chat",
          op: "added",
          id: message.id,
          message,
          cursor: frame.event.id ?? message.cursor,
        };
        if (frame.event.id) onCursor(frame.event.id);
      } else if (type === "message_updated" && data.message) {
        const message = mapMessage(normalizeHeartMessage(data.message, chatId));
        mapped = { kind: "chat", op: "updated", id: message.id, message, cursor: message.cursor };
      } else if (type === "message_deleted" && data.message_id) {
        mapped = { kind: "chat", op: "removed", id: data.message_id };
      } else if (type === "reactions_updated" && data.message_id) {
        const full = await this.chat.get(chatId, data.message_id);
        if (full) {
          mapped = {
            kind: "chat",
            op: "updated",
            id: full.id,
            message: full,
            cursor: full.cursor,
          };
        }
      }
      if (!mapped) continue;
      if (inOpeningWindow && !sawCatchupCursor) {
        // Fresh watch with no after: port contract — nothing before ready.
        if (after === undefined) continue;
        pending.push(mapped);
        continue;
      }
      yield mapped;
    }
  }

  private async *watchObjects(
    spec: Extract<WatchSpec, { kind: "objects" }>,
    signal: AbortSignal | undefined,
    after: string | undefined,
  ): AsyncGenerator<WatchEvent> {
    // UNVERIFIED: heart search/stream has no resume; `after` is a mock/port extension
    // so resume-cursor conformance can run. Live heart ignores unknown body fields.
    const streamOpts: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {
      method: "POST",
      body: { type: spec.type, where: spec.where ?? {}, ...(after !== undefined ? { after } : {}) },
    };
    if (signal) streamOpts.signal = signal;
    const res = await this.client.stream(this.space("/search/stream"), streamOpts);
    if (!res.body) return;

    let ready = false;
    for await (const frame of parseSse(res.body)) {
      if (signal?.aborted) return;
      if (frame.kind !== "event") continue;
      const type = frame.event.type;
      const data = JSON.parse(frame.event.data) as {
        object?: HeartObject;
        object_id?: string;
      };
      if (type === "snapshot_complete") {
        ready = true;
        yield { kind: "ready" };
        continue;
      }
      let mapped: WatchEvent | undefined;
      if ((type === "object_added" || type === "object_updated") && data.object) {
        const object = mapObject(data.object, false);
        mapped = {
          kind: "object",
          op: type === "object_updated" ? "updated" : ready ? "added" : "upsert",
          id: object.id,
          object,
          cursor: object.cursor,
        };
      } else if (type === "object_removed" && data.object_id) {
        mapped = { kind: "object", op: "removed", id: data.object_id };
      }
      if (mapped) yield mapped;
    }
  }
}

function normalizeHeartMessage(raw: HeartMessage, chatId: string): HeartMessage {
  return { ...raw, chat_id: raw.chat_id ?? chatId };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export function createAnytypeAdapter(opts: AnytypeAdapterOptions): AnytypeAdapter {
  return new AnytypeAdapter(opts);
}
