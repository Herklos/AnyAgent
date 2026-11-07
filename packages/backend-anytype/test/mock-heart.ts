/**
 * HTTP facade over MemoryBackend for CI conformance of @anyagent/backend-anytype.
 * Serves the **documented** heart v2 routes from docs/research/anytype-api.md
 * (anyproto/anytype-heart@09bd4b5), not invented shortcuts. Chat/object streams
 * use spike 001 framing. Not a live anytype-heart.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type ChatMessage,
  Conflict,
  MemoryBackend,
  NotFound,
  type ObjectRecord,
  type TypeDef,
  Unauthorized,
  type WatchEvent,
} from "@anyagent/backend";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === null ? "" : JSON.stringify(body));
}

function sse(res: ServerResponse, type: string, data: unknown, id?: string) {
  res.write(`${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function toHeartObject(o: ObjectRecord, includeBody: boolean) {
  return {
    id: o.id,
    type: o.type,
    name: o.name,
    fields: o.fields,
    field_versions: o.fieldVersions,
    author_id: o.authorId,
    modified_by_id: o.modifiedById,
    created_at: o.createdAt,
    modified_at: o.modifiedAt,
    cursor: o.cursor,
    ...(includeBody && o.body !== undefined ? { body: o.body } : {}),
  };
}

function toHeartMessage(m: ChatMessage) {
  return {
    id: m.id,
    chat_id: m.chatId,
    author_id: m.authorId,
    text: m.text,
    reply_to: m.replyTo,
    agent: m.agent,
    mentions: m.mentions,
    control: m.control,
    created_at: m.createdAt,
    edited: m.edited,
    reactions: m.reactions,
    cursor: m.cursor,
  };
}

export interface MockHeart {
  server: Server;
  url: string;
  spaceId: string;
  token: string;
  /** Key identity from whoami (distinct from participant). */
  keyId: string;
  backend: MemoryBackend;
  close: () => Promise<void>;
  /** Test hook: force the next chat stream connect to drop after N live frames. */
  dropChatStreamAfter?: number;
}

export async function startMockHeart(
  opts: { token?: string; spaceId?: string; keyId?: string } = {},
): Promise<MockHeart> {
  const token = opts.token ?? "test-token";
  const spaceId = opts.spaceId ?? "space-test";
  const keyId = opts.keyId ?? "key-test";
  const backend = new MemoryBackend();
  const types = new Map<string, TypeDef>();
  const chatNames = new Map<string, string>();
  const mock: MockHeart = {
    server: null as unknown as Server,
    url: "",
    spaceId,
    token,
    keyId,
    backend,
    close: async () => undefined,
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) {
        json(res, 401, { code: "unauthorized" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";

      // Key identity — distinct from the space participant (members/me).
      if (method === "GET" && path === "/v2/auth/whoami") {
        json(res, 200, { id: keyId });
        return;
      }

      const spacePrefix = `/v2/spaces/${spaceId}`;
      if (!path.startsWith(spacePrefix)) {
        json(res, 404, { code: "not_found" });
        return;
      }
      const rest = path.slice(spacePrefix.length);

      // Participant identity (what message authors use).
      if (method === "GET" && rest === "/members/me") {
        const me = await backend.identity.self();
        const role = await backend.identity.roleOf(me.id);
        json(res, 200, { id: me.id, role });
        return;
      }

      if (method === "GET" && rest.startsWith("/members/")) {
        const id = decodeURIComponent(rest.slice("/members/".length));
        const role = await backend.identity.roleOf(id);
        json(res, 200, { id, role });
        return;
      }

      // Schema: types + properties (no /schema/ensure).
      if (method === "GET" && rest === "/types") {
        json(res, 200, { types: [...types.values()] });
        return;
      }
      if (method === "POST" && rest === "/types") {
        const body = JSON.parse(await readBody(req)) as TypeDef;
        types.set(body.key, body);
        await backend.ensureSchema([body]);
        json(res, 200, body);
        return;
      }
      if (method === "GET" && rest === "/properties") {
        const all = [...types.values()].flatMap((t) =>
          t.fields.map((f) => ({ ...f, type_key: t.key })),
        );
        json(res, 200, { properties: all });
        return;
      }
      if (method === "POST" && rest === "/properties") {
        const body = JSON.parse(await readBody(req)) as {
          type_key: string;
          key: string;
          label: string;
          format: TypeDef["fields"][0]["format"];
          options?: string[];
        };
        const t = types.get(body.type_key);
        if (!t) {
          json(res, 404, { code: "not_found" });
          return;
        }
        if (!t.fields.some((f) => f.key === body.key)) {
          t.fields.push({
            key: body.key,
            label: body.label,
            format: body.format,
            ...(body.options ? { options: body.options } : {}),
          });
          await backend.ensureSchema([t]);
        }
        json(res, 200, body);
        return;
      }

      // Object list via search (documented), not /objects/list.
      if (method === "POST" && rest === "/search") {
        const body = JSON.parse(await readBody(req)) as {
          type?: string;
          where?: Record<string, string | number | boolean>;
        };
        const objects = await backend.org.list(body.type ?? "", body.where ?? {});
        json(res, 200, { objects: objects.map((o) => toHeartObject(o, false)) });
        return;
      }

      if (method === "GET" && rest.startsWith("/objects/")) {
        const id = decodeURIComponent(rest.slice("/objects/".length));
        const o = await backend.org.get(id);
        if (!o) {
          json(res, 404, { code: "not_found" });
          return;
        }
        json(res, 200, toHeartObject(o, true));
        return;
      }

      if (method === "POST" && rest === "/objects") {
        const body = JSON.parse(await readBody(req)) as {
          type: string;
          name: string;
          fields?: Record<string, unknown>;
          body?: string;
        };
        const o = await backend.objects.create(body.type, {
          name: body.name,
          fields: body.fields as never,
          body: body.body,
        });
        json(res, 200, toHeartObject(o, true));
        return;
      }

      if (method === "PATCH" && rest.startsWith("/objects/")) {
        const id = decodeURIComponent(rest.slice("/objects/".length));
        const body = JSON.parse(await readBody(req)) as {
          patch?: Record<string, unknown>;
          fields?: Record<string, unknown>;
          expect?: Record<string, string>;
        };
        const patch = (body.patch ?? body.fields ?? {}) as never;
        const o = await backend.objects.update(id, patch, { expect: body.expect });
        json(res, 200, toHeartObject(o, true));
        return;
      }

      // Chats: list + create (no /chats/general).
      if (method === "GET" && rest === "/chats") {
        const chats = [...chatNames.entries()].map(([id, name]) => ({ id, name }));
        // Ensure general exists in the memory backend so posts work after create.
        if (!chats.some((c) => c.name.toLowerCase() === "general")) {
          const id = await backend.chat.general();
          chatNames.set(id, "general");
          chats.push({ id, name: "general" });
        }
        json(res, 200, { chats });
        return;
      }

      if (method === "POST" && rest === "/chats") {
        const body = JSON.parse(await readBody(req)) as { name: string };
        const id = await backend.chat.create(body);
        chatNames.set(id, body.name);
        json(res, 200, { id, name: body.name });
        return;
      }

      const streamChat = /^\/chats\/([^/]+)\/messages\/stream$/.exec(rest);
      if (method === "GET" && streamChat) {
        const chatId = decodeURIComponent(streamChat[1]!);
        const lastEventId = (req.headers["last-event-id"] as string | undefined) ?? undefined;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const ac = new AbortController();
        req.on("close", () => ac.abort());

        // Opaque / non-integer Last-Event-ID → resync_required (heart contract).
        let after = lastEventId;
        if (lastEventId !== undefined && !/^\d+$/.test(lastEventId)) {
          sse(res, "resync_required", { type: "resync_required" });
          after = undefined;
        }

        // Drive the whole stream from MemoryBackend so catch-up includes removals.
        let maxCursor = after ?? "0";
        let liveCount = 0;
        let pastReady = false;
        try {
          for await (const ev of backend.events.watch(
            { kind: "chat", chatId },
            { after, signal: ac.signal },
          )) {
            if (ev.kind === "ready") {
              // Trailing id-only cursor frame ends the opening window.
              res.write(`id: ${maxCursor}\n\n`);
              pastReady = true;
              continue;
            }
            if (ev.kind !== "chat") continue;
            if (ev.op === "removed") {
              sse(res, "message_deleted", { type: "message_deleted", message_id: ev.id });
            } else if ((ev.op === "updated" || ev.op === "upsert") && ev.message) {
              // Catch-up upserts and live updates → message_updated / message_added.
              const type = pastReady || ev.op === "updated" ? "message_updated" : "message_added";
              if (type === "message_added") {
                sse(res, type, { type, message: toHeartMessage(ev.message) }, ev.message.cursor);
              } else {
                sse(res, type, { type, message: toHeartMessage(ev.message) });
              }
            } else if (ev.message) {
              sse(
                res,
                "message_added",
                { type: "message_added", message: toHeartMessage(ev.message) },
                ev.message.cursor,
              );
            }
            if (ev.cursor) maxCursor = ev.cursor;
            if (pastReady) {
              liveCount++;
              if (mock.dropChatStreamAfter !== undefined && liveCount >= mock.dropChatStreamAfter) {
                res.destroy();
                return;
              }
            }
          }
        } catch {
          // client gone
        }
        res.end();
        return;
      }

      const searchStream = rest === "/search/stream";
      if (method === "POST" && searchStream) {
        const body = JSON.parse(await readBody(req)) as {
          type?: string;
          where?: Record<string, string | number | boolean>;
          /** UNVERIFIED mock extension: port resume cursor (heart has no object resume). */
          after?: string;
        };
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const ac = new AbortController();
        req.on("close", () => ac.abort());
        // UNVERIFIED: real search/stream is always a fresh snapshot; the mock
        // honours `after` so the port's resume-cursor checks can run in CI.
        try {
          for await (const ev of backend.events.watch(
            { kind: "objects", type: body.type ?? "", where: body.where },
            { after: body.after, signal: ac.signal },
          )) {
            if (ev.kind === "ready") {
              sse(res, "snapshot_complete", { type: "snapshot_complete", space_id: spaceId });
              continue;
            }
            if (ev.kind !== "object") continue;
            if (ev.op === "removed") {
              sse(res, "object_removed", {
                type: "object_removed",
                space_id: spaceId,
                object_id: ev.id,
              });
            } else if (ev.object) {
              const type =
                ev.op === "updated"
                  ? "object_updated"
                  : ev.op === "upsert"
                    ? "object_added"
                    : "object_added";
              sse(res, type, {
                type,
                space_id: spaceId,
                object: toHeartObject(ev.object, false),
              });
            }
          }
        } catch {
          // client gone
        }
        res.end();
        return;
      }

      const msgMatch = /^\/chats\/([^/]+)\/messages(?:\/([^/]+))?(?:\/reactions)?$/.exec(rest);
      if (msgMatch) {
        const chatId = decodeURIComponent(msgMatch[1]!);
        const messageId = msgMatch[2] ? decodeURIComponent(msgMatch[2]) : undefined;
        const isReactions = rest.endsWith("/reactions");

        if (method === "POST" && !messageId) {
          const body = JSON.parse(await readBody(req));
          json(res, 200, toHeartMessage(await backend.chat.post(chatId, body)));
          return;
        }
        if (method === "GET" && !messageId) {
          const limit = url.searchParams.get("limit");
          const messages = await backend.chat.history(chatId, {
            limit: limit ? Number(limit) : undefined,
          });
          json(res, 200, { messages: messages.map(toHeartMessage) });
          return;
        }
        if (method === "GET" && messageId && !isReactions) {
          const m = await backend.chat.get(chatId, messageId);
          if (!m) {
            json(res, 404, { code: "not_found" });
            return;
          }
          // ?reactions=full is accepted; mock already stores participant ids.
          json(res, 200, toHeartMessage(m));
          return;
        }
        if (method === "PATCH" && messageId && !isReactions) {
          const body = JSON.parse(await readBody(req)) as { text: string };
          json(res, 200, toHeartMessage(await backend.chat.edit(chatId, messageId, body.text)));
          return;
        }
        if (method === "DELETE" && messageId && !isReactions) {
          await backend.chat.remove(chatId, messageId);
          json(res, 204, null);
          return;
        }
        if (method === "POST" && messageId && isReactions) {
          // Toggle: body is { emoji } only (documented as toggle, not {on}).
          const body = JSON.parse(await readBody(req)) as { emoji: string };
          const me = (await backend.identity.self()).id;
          const cur = await backend.chat.get(chatId, messageId);
          if (!cur) {
            json(res, 404, { code: "not_found" });
            return;
          }
          const has = (cur.reactions[body.emoji] ?? []).includes(me);
          json(
            res,
            200,
            toHeartMessage(await backend.chat.react(chatId, messageId, body.emoji, !has)),
          );
          return;
        }
      }

      json(res, 404, { code: "not_found", path: rest });
    } catch (err) {
      if (err instanceof Unauthorized) {
        json(res, 401, { error: err.message });
        return;
      }
      if (err instanceof NotFound) {
        json(res, 404, { error: err.message });
        return;
      }
      if (err instanceof Conflict) {
        json(res, 409, { error: err.message, fields: err.fields, objectId: err.objectId });
        return;
      }
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  mock.server = server;
  mock.url = `http://127.0.0.1:${addr.port}`;
  mock.close = () =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  return mock;
}

/** Exported for SSE unit tests that need raw frames (spike 001 style). */
export function writeSse(res: ServerResponse, type: string, data: unknown, id?: string) {
  sse(res, type, data, id);
}

export type { WatchEvent };
