/**
 * Copied from spikes/016-backend-port-any/memory-backend.ts.
 * Licence: Apache-2.0 (same as anyagent).
 * Changes: ObjectRecord.body; org.list strips body; chat.create; Conflict/NotFound from errors.ts;
 * optional faultHook for error-mapping tests; skipLiveDedup mutation option.
 */
import { Conflict, NotFound } from "./errors.js";
import {
  type Backend,
  type Capability,
  type ChatMessage,
  compareCursor,
  type FieldValue,
  type ObjectRecord,
  type PostInput,
  type Scalar,
  type SchemaAdmin,
  type TypeDef,
  type WatchEvent,
  type WatchSpec,
} from "./port.js";
import { AsyncQueue } from "./queue.js";

interface MsgRow {
  m: ChatMessage;
  deleted: boolean;
  seq: number;
}
interface ObjRow {
  o: ObjectRecord;
  seq: number;
}
type Listener = (e: WatchEvent) => void;

export interface MemoryOptions {
  /** A deliberate bug: ignore the resume cursor and replay everything. The suite must catch it. */
  replayAll?: boolean;
  /** A deliberate bug: do not de-duplicate live events against catch-up. */
  skipLiveDedup?: boolean;
}

export class MemoryBackend implements Backend, SchemaAdmin {
  readonly name = "memory";
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "resume-cursor",
    "removal-resume",
    "field-versions",
    "roles",
    "agent-envelope",
  ]);
  private seq = 0;
  private n = 0;
  private types = new Map<string, TypeDef>();
  private objs = new Map<string, ObjRow>();
  private chats = new Map<string, Map<string, MsgRow>>();
  private listeners = new Set<Listener>();
  readonly me = "memory-account";

  private readonly opts: MemoryOptions;

  constructor(opts: MemoryOptions = {}) {
    this.opts = opts;
  }

  private bump = () => ++this.seq;
  private id = (p: string) => `${p}${++this.n}`;
  private emit(e: WatchEvent) {
    for (const l of this.listeners) l(e);
  }

  async ensureSchema(defs: TypeDef[]): Promise<void> {
    for (const d of defs) if (!this.types.has(d.key)) this.types.set(d.key, d);
  }

  readonly identity = {
    self: async () => ({ id: this.me }),
    roleOf: async (id: string) => (id === this.me ? ("owner" as const) : undefined),
  };

  private snapshotObj(row: ObjRow, includeBody: boolean): ObjectRecord {
    const base: ObjectRecord = {
      ...row.o,
      fields: { ...row.o.fields },
      fieldVersions: { ...row.o.fieldVersions },
      cursor: String(row.seq),
    };
    if (includeBody && row.o.body !== undefined) base.body = row.o.body;
    else delete base.body;
    return base;
  }

  readonly org = {
    list: async (type: string, where: Record<string, Scalar> = {}) =>
      [...this.objs.values()]
        .filter(
          (r) => r.o.type === type && Object.entries(where).every(([k, v]) => r.o.fields[k] === v),
        )
        .map((r) => this.snapshotObj(r, false)),
    get: async (id: string) => {
      const r = this.objs.get(id);
      return r ? this.snapshotObj(r, true) : undefined;
    },
  };

  readonly objects = {
    create: async (
      type: string,
      input: { name: string; fields?: Record<string, FieldValue>; body?: string },
    ) => {
      if (!this.types.has(type)) throw new NotFound(`type ${type}`);
      const s = this.bump();
      const now = new Date().toISOString();
      const fields = Object.fromEntries(
        Object.entries(input.fields ?? {}).filter(([, v]) => v !== null),
      );
      const o: ObjectRecord = {
        id: this.id("o"),
        type,
        name: input.name,
        fields,
        fieldVersions: Object.fromEntries(Object.keys(fields).map((k) => [k, String(s)])),
        authorId: this.me,
        modifiedById: this.me,
        createdAt: now,
        modifiedAt: now,
        cursor: String(s),
        ...(input.body !== undefined ? { body: input.body } : {}),
      };
      const row = { o, seq: s };
      this.objs.set(o.id, row);
      if (this.types.get(type)?.chat) this.chats.set(o.id, new Map());
      this.emit({
        kind: "object",
        op: "added",
        id: o.id,
        object: this.snapshotObj(row, true),
        cursor: String(s),
      });
      return this.snapshotObj(row, true);
    },
    update: async (
      id: string,
      patch: Record<string, FieldValue>,
      opts: { expect?: Record<string, string> } = {},
    ) => {
      const row = this.objs.get(id);
      if (!row) throw new NotFound(`object ${id}`);
      if (opts.expect) {
        const stale = Object.keys(opts.expect).filter(
          (k) => row.o.fieldVersions[k] !== opts.expect?.[k],
        );
        if (stale.length) throw new Conflict(id, stale);
      }
      const s = this.bump();
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete row.o.fields[k];
        else row.o.fields[k] = v;
        row.o.fieldVersions[k] = String(s);
      }
      row.o.modifiedAt = new Date().toISOString();
      row.o.modifiedById = this.me;
      row.seq = s;
      this.emit({
        kind: "object",
        op: "updated",
        id,
        object: this.snapshotObj(row, true),
        cursor: String(s),
      });
      return this.snapshotObj(row, true);
    },
  };

  private chatRows(chatId: string): Map<string, MsgRow> {
    const c = this.chats.get(chatId);
    if (!c) throw new NotFound(`chat ${chatId}`);
    return c;
  }
  private msg(row: MsgRow): ChatMessage {
    return {
      ...row.m,
      reactions: Object.fromEntries(Object.entries(row.m.reactions).map(([e, w]) => [e, [...w]])),
      cursor: String(row.seq),
    };
  }
  private touch(chatId: string, row: MsgRow, op: "added" | "updated") {
    row.seq = this.bump();
    this.emit({ kind: "chat", op, id: row.m.id, message: this.msg(row), cursor: String(row.seq) });
    void chatId;
  }

  readonly chat = {
    general: async () => {
      if (!this.chats.has("general")) this.chats.set("general", new Map());
      return "general";
    },
    create: async (input: { name: string }) => {
      const id = this.id("chat");
      this.chats.set(id, new Map());
      void input.name;
      return id;
    },
    post: async (chatId: string, input: PostInput) => {
      const rows = this.chatRows(chatId);
      const id = this.id("m");
      const m: ChatMessage = {
        id,
        chatId,
        authorId: this.me,
        text: input.text ?? "",
        mentions: [],
        createdAt: new Date().toISOString(),
        edited: false,
        reactions: {},
        cursor: "0",
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.control ? { control: input.control } : {}),
      };
      const row: MsgRow = { m, deleted: false, seq: 0 };
      rows.set(id, row);
      this.touch(chatId, row, "added");
      return this.msg(row);
    },
    edit: async (chatId: string, id: string, text: string) => {
      const row = this.chatRows(chatId).get(id);
      if (!row || row.deleted) throw new NotFound(`message ${id}`);
      row.m.text = text;
      row.m.edited = true;
      this.touch(chatId, row, "updated");
      return this.msg(row);
    },
    react: async (chatId: string, id: string, emoji: string, on: boolean) => {
      const row = this.chatRows(chatId).get(id);
      if (!row || row.deleted) throw new NotFound(`message ${id}`);
      const who = new Set(row.m.reactions[emoji] ?? []);
      if (who.has(this.me) === on) return this.msg(row);
      if (on) who.add(this.me);
      else who.delete(this.me);
      if (who.size) row.m.reactions[emoji] = [...who];
      else delete row.m.reactions[emoji];
      this.touch(chatId, row, "updated");
      return this.msg(row);
    },
    remove: async (chatId: string, id: string) => {
      const row = this.chatRows(chatId).get(id);
      if (!row || row.deleted) throw new NotFound(`message ${id}`);
      row.deleted = true;
      row.seq = this.bump();
      this.emit({ kind: "chat", op: "removed", id, cursor: String(row.seq) });
    },
    get: async (chatId: string, id: string) => {
      const row = this.chatRows(chatId).get(id);
      return row && !row.deleted ? this.msg(row) : undefined;
    },
    history: async (chatId: string, opts: { limit?: number } = {}) =>
      [...this.chatRows(chatId).values()]
        .filter((r) => !r.deleted)
        .sort((a, b) => Number(a.m.id.slice(1)) - Number(b.m.id.slice(1)))
        .slice(-(opts.limit ?? 50))
        .map((r) => this.msg(r)),
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
    const q = new AsyncQueue<WatchEvent>();
    const wanted = (e: WatchEvent) =>
      spec.kind === "chat"
        ? e.kind === "chat" &&
          (e.message?.chatId === spec.chatId || this.chats.get(spec.chatId)?.has(e.id) === true)
        : e.kind === "object" &&
          (e.op === "removed" ||
            (e.object?.type === spec.type &&
              Object.entries(spec.where ?? {}).every(([k, v]) => e.object?.fields[k] === v)));
    const l: Listener = (e) => {
      if (wanted(e)) q.push(e);
    };
    this.listeners.add(l);
    opts.signal?.addEventListener("abort", () => q.close(), { once: true });
    try {
      const after = this.opts.replayAll ? undefined : opts.after;
      let last = after;
      /** Catch-up events, retained so skipLiveDedup can re-emit them as live duplicates. */
      const caught: WatchEvent[] = [];
      if (spec.kind === "chat") {
        if (opts.after !== undefined || this.opts.replayAll) {
          const rows = [...this.chatRows(spec.chatId).values()].sort((a, b) => a.seq - b.seq);
          for (const r of rows) {
            if (after !== undefined && r.seq <= Number(after)) continue;
            last = String(r.seq);
            const ev: WatchEvent = r.deleted
              ? { kind: "chat", op: "removed", id: r.m.id, cursor: String(r.seq) }
              : {
                  kind: "chat",
                  op: "upsert",
                  id: r.m.id,
                  message: this.msg(r),
                  cursor: String(r.seq),
                };
            caught.push(ev);
            yield ev;
          }
        }
      } else {
        const rows = [...this.objs.values()]
          .filter(
            (r) =>
              r.o.type === spec.type &&
              Object.entries(spec.where ?? {}).every(([k, v]) => r.o.fields[k] === v),
          )
          .sort((a, b) => a.seq - b.seq);
        for (const r of rows) {
          if (after !== undefined && r.seq <= Number(after)) continue;
          last = String(r.seq);
          const ev: WatchEvent = {
            kind: "object",
            op: "upsert",
            id: r.o.id,
            object: this.snapshotObj(r, true),
            cursor: String(r.seq),
          };
          caught.push(ev);
          yield ev;
        }
      }
      yield { kind: "ready" };
      void caught;
      for (;;) {
        const e = await q.next();
        if (!e) return;
        if (
          !this.opts.skipLiveDedup &&
          "cursor" in e &&
          e.cursor &&
          last !== undefined &&
          compareCursor(e.cursor, last) <= 0
        ) {
          continue;
        }
        if ("cursor" in e && e.cursor) last = e.cursor;
        yield e;
        // Deliberate bug: emit every live event twice (no de-dupe against prior delivery).
        if (this.opts.skipLiveDedup) yield e;
      }
    } finally {
      this.listeners.delete(l);
    }
  }
}
