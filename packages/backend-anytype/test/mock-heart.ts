/**
 * HTTP facade over MemoryBackend for CI conformance of @anyagent/backend-anytype.
 * Not a live anytype-heart. Wire shapes match mapping.ts (unverified vs heart until spike 002).
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
  type WatchSpec,
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
  res.end(JSON.stringify(body));
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
  backend: MemoryBackend;
  close: () => Promise<void>;
}

export async function startMockHeart(
  opts: { token?: string; spaceId?: string } = {},
): Promise<MockHeart> {
  const token = opts.token ?? "test-token";
  const spaceId = opts.spaceId ?? "space-test";
  const backend = new MemoryBackend();

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) {
        json(res, 401, { code: "unauthorized" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/v2/auth/whoami") {
        json(res, 200, { id: backend.me });
        return;
      }

      const spacePrefix = `/v2/spaces/${spaceId}`;
      if (!path.startsWith(spacePrefix) && path !== "/v2/auth/whoami") {
        json(res, 404, { code: "not_found" });
        return;
      }
      const rest = path.slice(spacePrefix.length);

      if (method === "GET" && rest.startsWith("/members/")) {
        const id = decodeURIComponent(rest.slice("/members/".length));
        const role = await backend.identity.roleOf(id);
        json(res, 200, { id, role });
        return;
      }

      if (method === "POST" && rest === "/schema/ensure") {
        const body = JSON.parse(await readBody(req)) as { defs: TypeDef[] };
        await backend.ensureSchema(body.defs);
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && rest === "/objects/list") {
        const body = JSON.parse(await readBody(req)) as {
          type: string;
          where?: Record<string, string | number | boolean>;
        };
        const objects = await backend.org.list(body.type, body.where);
        json(res, 200, { objects: objects.map((o) => toHeartObject(o, false)) });
        return;
      }

      if (method === "GET" && rest.startsWith("/objects/") && rest !== "/objects/list") {
        const id = decodeURIComponent(rest.slice("/objects/".length));
        const o = await backend.org.get(id);
        if (!o) {
          json(res, 200, { missing: true });
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
          patch: Record<string, unknown>;
          expect?: Record<string, string>;
        };
        const o = await backend.objects.update(id, body.patch as never, { expect: body.expect });
        json(res, 200, toHeartObject(o, true));
        return;
      }

      if (method === "GET" && rest === "/chats/general") {
        json(res, 200, { id: await backend.chat.general() });
        return;
      }

      if (method === "POST" && rest === "/chats") {
        const body = JSON.parse(await readBody(req)) as { name: string };
        json(res, 200, { id: await backend.chat.create(body) });
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
            json(res, 200, { missing: true });
            return;
          }
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
          const body = JSON.parse(await readBody(req)) as { emoji: string; on: boolean };
          json(
            res,
            200,
            toHeartMessage(await backend.chat.react(chatId, messageId, body.emoji, body.on)),
          );
          return;
        }
      }

      if (method === "GET" && rest.startsWith("/events/stream")) {
        const kind = url.searchParams.get("kind");
        const after = url.searchParams.get("after") ?? undefined;
        let spec: WatchSpec;
        if (kind === "chat") {
          spec = { kind: "chat", chatId: url.searchParams.get("chatId") ?? "" };
        } else {
          const whereRaw = url.searchParams.get("where") ?? "{}";
          spec = {
            kind: "objects",
            type: url.searchParams.get("type") ?? "",
            where: JSON.parse(whereRaw) as Record<string, string | number | boolean>,
          };
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const ac = new AbortController();
        req.on("close", () => ac.abort());
        try {
          for await (const ev of backend.events.watch(spec, { after, signal: ac.signal })) {
            const data = JSON.stringify(ev);
            res.write(`event: watch\ndata: ${data}\n\n`);
          }
        } catch {
          // client gone
        }
        res.end();
        return;
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
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    server,
    url,
    spaceId,
    token,
    backend,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Exported for SSE unit tests that need raw frames (spike 001 style). */
export function writeSse(res: ServerResponse, type: string, data: unknown, id?: string) {
  res.write(`${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export type { WatchEvent };
