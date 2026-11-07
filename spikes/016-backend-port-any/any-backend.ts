// Adapter: the backend port over `any`'s local HTTP API (anyproto/any@0b73c01, docs/03-api.md, docs/04-events.md).
// Facts it relies on, each observed on a live server in this spike (see README):
//   - values live at record[typeId][propId], and record._ver[typeId][propId] is that property's own version
//   - chat messages are records of the `chat_messages` dataset of a chat object; an object whose type declares a
//     `chat` part is its own chat
//   - streams have no replay; `_applySeq` (peer-local, monotonic, counts edits and reactions) is the resume cursor
import { parseSse } from "../001-ts-sse/sse.ts";
import { AsyncQueue, sleep } from "./queue.ts";
import {
  ConflictError,
  NotFoundError,
  type Backend,
  type Capability,
  type ChatMessage,
  type FieldValue,
  type ObjectRecord,
  type PostInput,
  type Role,
  type Scalar,
  type SchemaAdmin,
  type TypeDef,
  type WatchEvent,
  type WatchSpec,
} from "./port.ts";

export class AnyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.name = "AnyError";
    this.status = status;
    this.code = code;
  }
}

interface PropInfo {
  id: string;
  key: string;
  kind: string;
  slug?: string;
  multiple: boolean;
}
interface TypeInfo {
  id: string;
  key: string;
  props: Map<string, PropInfo>;
}

type Rec = Record<string, any>;

const CHAT_DATASET = "chat_messages";
const PAGE = 200;

export class AnyBackend implements Backend, SchemaAdmin {
  readonly name = "any";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "resume-cursor",
    "removal-resume",
    "field-versions",
    "roles",
    "agent-envelope",
  ]);

  private byKey = new Map<string, TypeInfo>();
  private byId = new Map<string, TypeInfo>();
  private selfId?: string;
  private generalChat?: string;

  readonly base: string;
  readonly spaceId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(base: string, spaceId: string, fetchImpl: typeof fetch = fetch) {
    this.base = base;
    this.spaceId = spaceId;
    this.fetchImpl = fetchImpl;
  }

  static async createSpace(base: string, name: string, fetchImpl: typeof fetch = fetch): Promise<string> {
    const r = await fetchImpl(`${base}/v1/spaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw await toError(r);
    return ((await r.json()) as Rec).id as string;
  }

  static async health(base: string, fetchImpl: typeof fetch = fetch): Promise<Rec> {
    const r = await fetchImpl(`${base}/v1/health`);
    if (!r.ok) throw await toError(r);
    return (await r.json()) as Rec;
  }

  // ---------------------------------------------------------------- HTTP

  private async req(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<any> {
    const r = await this.fetchImpl(`${this.base}/v1${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok && !okStatuses.includes(r.status)) throw await toError(r);
    if (r.status === 204) return undefined;
    const text = await r.text();
    return text ? JSON.parse(text) : undefined;
  }

  private sp(path: string): string {
    return `/spaces/${this.spaceId}${path}`;
  }

  // ---------------------------------------------------------------- schema

  async refresh(): Promise<void> {
    this.byKey.clear();
    this.byId.clear();
    const { types } = (await this.req("GET", this.sp("/types"))) as { types: Rec[] };
    for (const t of types) {
      if (!t.xKey || t.builtIn) continue;
      const { properties } = (await this.req("GET", this.sp(`/types/${t.id}/properties`))) as { properties: Rec[] };
      const props = new Map<string, PropInfo>();
      for (const p of properties) {
        if (!p.xKey) continue;
        props.set(p.xKey, {
          id: p.id,
          key: p.xKey,
          kind: p.kind,
          slug: p.xFormat?.type,
          multiple: p.xFormat?.config?.multiple === true,
        });
      }
      const info: TypeInfo = { id: t.id, key: t.xKey, props };
      this.byKey.set(t.xKey, info);
      this.byId.set(t.id, info);
    }
  }

  async ensureSchema(defs: TypeDef[]): Promise<void> {
    await this.refresh();
    for (const def of defs) {
      let info = this.byKey.get(def.key);
      if (!info) {
        const body: Rec = { name: def.label, xKey: def.key };
        if (def.chat) body.layout = { type: "chat" };
        const r = await this.req("POST", this.sp("/types"), body);
        info = { id: r.typeId, key: def.key, props: new Map() };
        this.byKey.set(def.key, info);
        this.byId.set(info.id, info);
      }
      for (const f of def.fields) {
        if (info.props.has(f.key)) continue;
        const body: Rec = { name: f.label, xKey: f.key };
        switch (f.format) {
          case "text":
            body.kind = "string";
            break;
          case "number":
            body.kind = "number";
            break;
          case "checkbox":
            body.kind = "boolean";
            break;
          case "select":
          case "multi_select": {
            body.kind = "array";
            const options: Rec = {};
            (f.options ?? []).forEach((o, i) => (options[o] = { name: o, color: "grey", pos: `a${i.toString(36)}` }));
            body.xFormat = { type: "choice", config: { multiple: f.format === "multi_select" }, options };
            break;
          }
          case "objects":
            body.kind = "array";
            body.xFormat = { type: "relation" };
            break;
        }
        await this.req("POST", this.sp(`/types/${info.id}/properties`), body);
      }
      if (def.chat) {
        const { parts } = (await this.req("GET", this.sp(`/types/${info.id}/parts`))) as { parts: Rec[] };
        const hasChat = parts.some((p) => (p.datasets ?? []).some((d: Rec) => d.module === "chat"));
        if (!hasChat) {
          await this.req("POST", this.sp(`/types/${info.id}/parts`), {
            key: "chat",
            name: "Chat",
            ui: { type: "chat" },
            datasets: [{ module: "chat" }],
          });
        }
      }
    }
    await this.refresh();
  }

  private type(key: string): TypeInfo {
    const t = this.byKey.get(key);
    if (!t) throw new NotFoundError(`type ${key} (run ensureSchema)`);
    return t;
  }

  // ---------------------------------------------------------------- values

  private encode(t: TypeInfo, key: string, v: FieldValue): unknown {
    const p = t.props.get(key);
    if (!p) throw new NotFoundError(`field ${key} on ${t.key}`);
    if (v === null) return null;
    if (p.slug === "relation") return (v as string[]).map((id) => `any://${id}`);
    if (p.slug === "choice") return p.multiple ? (v as string[]) : [v as string];
    return v;
  }

  private decode(p: PropInfo, raw: unknown): FieldValue {
    if (raw === undefined || raw === null) return null;
    if (p.slug === "relation") return (raw as string[]).map((u) => u.replace(/^any:\/\//, ""));
    if (p.slug === "choice") return p.multiple ? (raw as string[]) : ((raw as string[])[0] ?? null);
    return raw as FieldValue;
  }

  private toObject(rec: Rec): ObjectRecord {
    const typeId = rec.any?.type as string;
    const t = this.byId.get(typeId);
    const fields: Record<string, FieldValue> = {};
    const fieldVersions: Record<string, string> = {};
    if (t) {
      for (const p of t.props.values()) {
        const raw = rec[typeId]?.[p.id];
        if (raw !== undefined) fields[p.key] = this.decode(p, raw);
        const v = rec._ver?.[typeId]?.[p.id];
        if (v !== undefined) fieldVersions[p.key] = String(v);
      }
    }
    return {
      id: rec.id,
      type: t?.key ?? typeId,
      name: rec.any?.name ?? "",
      fields,
      fieldVersions,
      authorId: rec.author ?? "",
      modifiedById: rec.modifiedBy ?? "",
      createdAt: rec.createdAt?.$date ?? "",
      modifiedAt: rec.modifiedAt?.$date ?? "",
      cursor: String(rec._applySeq ?? 0),
    };
  }

  // ---------------------------------------------------------------- identity

  readonly identity = {
    self: async (): Promise<{ id: string }> => {
      if (!this.selfId) this.selfId = ((await AnyBackend.health(this.base, this.fetchImpl)).account as string) ?? "";
      return { id: this.selfId };
    },
    roleOf: async (participantId: string): Promise<Role | undefined> => {
      const self = await this.identity.self();
      const path = participantId === self.id ? "/members/me" : `/members/${participantId}`;
      const r = await this.req("GET", this.sp(path), undefined, [404]);
      // A member has a role only while active; "none" and the pending/removed statuses are "no role".
      if (!r || r.status !== "active") return undefined;
      const roles: Role[] = ["owner", "admin", "writer", "reader", "guest"];
      return roles.find((x) => x === r.permission);
    },
  };

  // ---------------------------------------------------------------- org + objects

  readonly org = {
    list: async (type: string, where: Record<string, Scalar> = {}): Promise<ObjectRecord[]> => {
      const t = this.type(type);
      const filter: Rec = { "any.type": t.id };
      for (const [k, v] of Object.entries(where)) {
        const p = t.props.get(k);
        if (!p) throw new NotFoundError(`field ${k} on ${type}`);
        filter[`${t.id}.${p.id}`] = v;
      }
      const r = await this.req("POST", this.sp("/objects/query"), { filter, sort: ["_applySeq"], limit: PAGE });
      if (r.records.length >= PAGE) throw new Error(`org.list(${type}) hit the page limit; paging is not built`);
      return (r.records as Rec[]).map((x) => this.toObject(x));
    },
    get: async (id: string): Promise<ObjectRecord | undefined> => {
      const r = await this.req("GET", this.sp(`/objects/${id}`), undefined, [404]);
      return r?.record ? this.toObject(r.record) : undefined;
    },
  };

  readonly objects = {
    create: async (type: string, input: { name: string; fields?: Record<string, FieldValue> }): Promise<ObjectRecord> => {
      const t = this.type(type);
      const props: Rec = {};
      for (const [k, v] of Object.entries(input.fields ?? {})) {
        if (v === null) continue;
        props[t.props.get(k)?.id ?? k] = this.encode(t, k, v);
      }
      const r = await this.req("POST", this.sp("/objects"), {
        type: t.id,
        initialProperties: { any: { name: input.name }, [t.id]: props },
      });
      return (await this.org.get(r.objectId))!;
    },
    update: async (
      id: string,
      patch: Record<string, FieldValue>,
      opts: { expect?: Record<string, string> } = {},
    ): Promise<ObjectRecord> => {
      const cur = await this.org.get(id);
      if (!cur) throw new NotFoundError(`object ${id}`);
      if (opts.expect) {
        // NOT atomic: `any` has no compare-and-set on property writes, so this is read, compare, write.
        const stale = Object.keys(opts.expect).filter((k) => cur.fieldVersions[k] !== opts.expect![k]);
        if (stale.length) throw new ConflictError(id, stale);
      }
      const t = this.type(cur.type);
      const body: Rec = {};
      for (const [k, v] of Object.entries(patch)) body[t.props.get(k)?.id ?? k] = this.encode(t, k, v);
      await this.req("POST", this.sp(`/properties/${id}/set/${t.id}`), { patch: body });
      return (await this.org.get(id))!;
    },
  };

  // ---------------------------------------------------------------- chat

  private toMessage(chatId: string, rec: Rec): ChatMessage {
    const reactions: Record<string, string[]> = {};
    for (const [emoji, who] of Object.entries((rec.reactions ?? {}) as Rec)) {
      const ids = Object.keys(who as Rec);
      if (ids.length) reactions[emoji] = ids;
    }
    const m: ChatMessage = {
      id: rec.id,
      chatId,
      authorId: rec.creator ?? "",
      text: rec.text ?? "",
      mentions: rec.mentions ?? [],
      createdAt: rec.createdAt?.$date ?? "",
      edited: rec._ver?.text !== undefined && rec._ver.text !== rec._ver.id,
      reactions,
      cursor: String(rec._applySeq ?? 0),
    };
    if (rec.replyToMessageId) m.replyTo = rec.replyToMessageId;
    if (rec.agent) m.agent = rec.agent;
    if (rec.control) m.control = rec.control;
    return m;
  }

  private async readMessage(chatId: string, id: string): Promise<ChatMessage | undefined> {
    const r = await this.req("POST", this.sp("/query"), {
      objectId: chatId,
      dataset: CHAT_DATASET,
      filter: { id },
      limit: 1,
    });
    return r.records[0] ? this.toMessage(chatId, r.records[0]) : undefined;
  }

  readonly chat = {
    general: async (): Promise<string> => {
      if (!this.generalChat) {
        const r = await this.req("POST", "/catalog/general-chat/setup", { spaceId: this.spaceId });
        this.generalChat = r.bundles[0].bundle.rootId as string;
      }
      return this.generalChat;
    },
    post: async (chatId: string, input: PostInput): Promise<ChatMessage> => {
      const body: Rec = {};
      if (input.text !== undefined) body.text = input.text;
      if (input.replyTo) body.replyToMessageId = input.replyTo;
      if (input.agent) body.agent = input.agent;
      if (input.control) body.control = input.control;
      const r = await this.req("POST", this.sp(`/objects/${chatId}/chat/messages`), body);
      return (await this.readMessage(chatId, r.recordIds[0]))!;
    },
    edit: async (chatId: string, id: string, text: string): Promise<ChatMessage> => {
      await this.req("PATCH", this.sp(`/objects/${chatId}/chat/messages/${id}`), { text });
      return (await this.readMessage(chatId, id))!;
    },
    react: async (chatId: string, id: string, emoji: string, on: boolean): Promise<ChatMessage> => {
      const me = (await this.identity.self()).id;
      const cur = await this.readMessage(chatId, id);
      if (!cur) throw new NotFoundError(`message ${id}`);
      const has = (cur.reactions[emoji] ?? []).includes(me);
      // The API only toggles; the port promises an end state, so read first.
      if (has !== on) {
        await this.req("POST", this.sp(`/objects/${chatId}/chat/messages/${id}/reactions/${encodeURIComponent(emoji)}`));
      }
      return (await this.readMessage(chatId, id))!;
    },
    remove: async (chatId: string, id: string): Promise<void> => {
      await this.req("DELETE", this.sp(`/objects/${chatId}/chat/messages/${id}`));
    },
    get: (chatId: string, id: string) => this.readMessage(chatId, id),
    history: async (chatId: string, opts: { limit?: number } = {}): Promise<ChatMessage[]> => {
      const r = await this.req("POST", this.sp("/query"), {
        objectId: chatId,
        dataset: CHAT_DATASET,
        sort: ["-_ver.id"],
        limit: opts.limit ?? 50,
      });
      return (r.records as Rec[]).map((x) => this.toMessage(chatId, x)).reverse();
    },
  };

  // ---------------------------------------------------------------- events

  readonly events = {
    watch: (spec: WatchSpec, opts: { after?: string; signal?: AbortSignal } = {}): AsyncIterable<WatchEvent> =>
      this.watch(spec, opts),
  };

  private async *watch(spec: WatchSpec, opts: { after?: string; signal?: AbortSignal }): AsyncGenerator<WatchEvent> {
    const { signal } = opts;
    const isChat = spec.kind === "chat";
    const typeInfo = spec.kind === "objects" ? this.type(spec.type) : undefined;

    const filter: Rec = {};
    if (typeInfo && spec.kind === "objects") {
      filter["any.type"] = typeInfo.id;
      for (const [k, v] of Object.entries(spec.where ?? {})) {
        const p = typeInfo.props.get(k);
        if (!p) throw new NotFoundError(`field ${k} on ${spec.type}`);
        filter[`${typeInfo.id}.${p.id}`] = v;
      }
    }
    const subPath = isChat ? this.sp("/query/subscribe") : this.sp("/objects/query/subscribe");
    const subBody: Rec = isChat
      ? { objectId: spec.chatId, dataset: CHAT_DATASET, sort: ["-_ver.id"], limit: 50 }
      : { filter, sort: ["-modifiedAt"], limit: PAGE };

    // the event for a record, without its op
    const map = (rec: Rec): Record<string, unknown> =>
      spec.kind === "chat"
        ? { kind: "chat", id: rec.id, message: this.toMessage(spec.chatId, rec), cursor: String(rec._applySeq) }
        : { kind: "object", id: rec.id, object: this.toObject(rec), cursor: String(rec._applySeq) };

    let last: bigint | undefined = opts.after === undefined ? undefined : BigInt(opts.after);
    let first = true;
    let backoff = 250;

    while (!signal?.aborted) {
      const frames = new AsyncQueue<{ type: string; data: any }>();
      const ac = new AbortController();
      signal?.addEventListener("abort", () => ac.abort(), { once: true });
      const pump = (async () => {
        try {
          const r = await this.fetchImpl(`${this.base}/v1${subPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(subBody),
            signal: ac.signal,
          });
          if (!r.ok || !r.body) throw await toError(r);
          for await (const f of parseSse(r.body)) {
            if (f.kind === "event") frames.push({ type: f.event.type, data: f.event.data ? JSON.parse(f.event.data) : {} });
          }
        } catch (e) {
          if (!ac.signal.aborted) frames.push({ type: "error", data: e });
        } finally {
          frames.close();
        }
      })();

      try {
        // 1. ready, then the bundled snapshot (the only point-in-time read; nothing is replayed after a drop)
        const ready = await frames.next();
        if (!ready) break;
        if (ready.type === "error") {
          if (ready.data instanceof AnyError && ready.data.status >= 400 && ready.data.status < 500) throw ready.data;
          throw ready.data;
        }
        const snap = await frames.next();
        if (!snap || snap.type !== "snapshot") throw new Error(`expected snapshot, got ${snap?.type}`);
        const snapRecords = (snap.data.records ?? []) as Rec[];

        // 2. catch up from the cursor (reconnects always have one), or take the initial state
        if (last !== undefined) {
          for (;;) {
            const body: Rec = isChat
              ? { objectId: spec.chatId, dataset: CHAT_DATASET, includeDeleted: true, filter: {} }
              : { filter: { ...filter } };
            body.sort = ["_applySeq"];
            body.limit = PAGE;
            body.filter._applySeq = { $gt: Number(last) };
            const page = (await this.req("POST", isChat ? this.sp("/query") : this.sp("/objects/query"), body)).records as Rec[];
            for (const rec of page) {
              if (rec._deletedAt) {
                yield { kind: isChat ? "chat" : "object", op: "removed", id: rec.id, cursor: String(rec._applySeq) } as WatchEvent;
              } else {
                yield { ...map(rec), op: "upsert" } as WatchEvent;
              }
              last = BigInt(rec._applySeq);
            }
            if (page.length < PAGE) break;
          }
        } else {
          let high = 0n;
          for (const rec of snapRecords) {
            const s = BigInt(rec._applySeq ?? 0);
            if (s > high) high = s;
            if (!isChat) yield { ...map(rec), op: "upsert" } as WatchEvent;
          }
          last = high; // the baseline a later reconnect resumes from
        }
        if (first) {
          first = false;
          yield { kind: "ready" };
        }
        backoff = 250;

        // 3. live, dropping what the catch-up already delivered
        for (;;) {
          const f = await frames.next();
          if (!f) break;
          if (f.type === "closed") {
            if (f.data.reason === "object_deleted" || f.data.reason === "deauthorized") {
              throw new AnyError(410, f.data.reason, "stream closed for good");
            }
            break;
          }
          if (f.type === "error") break;
          if (f.type !== "changes") continue;
          for (const batch of f.data as Rec[]) {
            for (const op of ["added", "updated"] as const) {
              for (const item of (batch[op] ?? []) as Rec[]) {
                const s = BigInt(item.doc._applySeq ?? 0);
                if (last !== undefined && s <= last) continue;
                last = s;
                yield { ...map(item.doc), op } as WatchEvent;
              }
            }
            for (const item of (batch.removed ?? []) as Rec[]) {
              // "displaced" and "filtered-out" are window effects, not deletions of the thing watched
              if (item.reason !== "deleted") continue;
              yield { kind: isChat ? "chat" : "object", op: "removed", id: item.id } as WatchEvent;
            }
          }
        }
      } finally {
        ac.abort();
        await pump;
      }
      if (signal?.aborted) break;
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, 5000);
    }
  }
}

async function toError(r: Response): Promise<AnyError> {
  let code = "http";
  let message = r.statusText;
  try {
    const j = (await r.json()) as Rec;
    code = j.error?.code ?? code;
    message = j.error?.message ?? message;
  } catch {
    /* not JSON */
  }
  return new AnyError(r.status, code, message);
}
