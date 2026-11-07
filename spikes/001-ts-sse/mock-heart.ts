// A mock of the two anytype-heart v2 streams anybot depends on, emitting
// heart's exact framing as read at anyproto/anytype-heart@09bd4b5:
//   GET  /v2/spaces/{space}/chats/{chat}/messages/stream  (core/api/v2/handler/chat_stream.go)
//   POST /v2/spaces/{space}/search/stream                 (core/api/v2/handler/search_stream.go)
//
// Chat frames: `id: <state_id>` only on message_added; message_updated,
// reactions_updated, message_deleted carry no id; a trailing id-only cursor
// frame follows the opening window; `: keepalive` comments; resync_required
// first when Last-Event-ID cannot be honoured.
// Search frames: no ids; object_added per match, snapshot_complete, then live
// object_added / object_updated / object_removed. The Go struct fields are
// Type, SpaceId, Object, ObjectId, Warnings; their JSON names below are
// inferred (snake_case like the rest of v2), not read from the source.
//
// This is a mock, not heart. It proves the TypeScript client, not the server.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export interface MockLog {
  chatConnects: { lastEventId: string | null }[];
  searchBodies: unknown[];
}

const msg = (id: string, stateId: string, author: string, text: string) => ({
  id,
  state_id: stateId,
  order: stateId,
  author: { id: author, name: author },
  author_id: author,
  at: "2026-11-06T21:00:00Z",
  text,
});

function sse(res: ServerResponse, type: string, data: unknown, id?: string) {
  res.write(`${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startMockHeart(token: string): Promise<{ server: Server; url: string; log: MockLog }> {
  const log: MockLog = { chatConnects: [], searchBodies: [] };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"code":"unauthorized"}');
      return;
    }
    const open = () =>
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

    if (req.method === "GET" && /^\/v2\/spaces\/[^/]+\/chats\/[^/]+\/messages\/stream/.test(req.url ?? "")) {
      const lastEventId = (req.headers["last-event-id"] as string | undefined) ?? null;
      log.chatConnects.push({ lastEventId });
      open();
      if (lastEventId === null) {
        // First connect: opening window (history), sent out of state order to
        // show why the trailing cursor exists, then live traffic, then a drop.
        sse(res, "message_added", { id: "s2", type: "message_added", message: msg("m2", "s2", "alice", "older reply") }, "s2");
        sse(res, "message_added", { id: "s1", type: "message_added", message: msg("m1", "s1", "alice", "hello team") }, "s1");
        res.write("id: s2\n\n"); // cursor: the window's max state id
        await later(30);
        res.write(": keepalive\n\n");
        // Live: CRLF line endings and a chunk split mid-frame, to exercise the parser.
        // The second write starts in the middle of the 3-byte UTF-8 "⚓".
        const live = Buffer.from(
          "id: s3\r\nevent: message_added\r\ndata: " +
            JSON.stringify({ id: "s3", type: "message_added", message: msg("m3", "s3", "herklos", "@chief please triage the inbox ⚓") }) +
            "\r\n\r\n",
        );
        const anchor = live.indexOf(Buffer.from("⚓")) + 1;
        res.write(live.subarray(0, anchor));
        await later(10);
        res.write(live.subarray(anchor));
        sse(res, "reactions_updated", { type: "reactions_updated", message_id: "m1", reactions: { "👀": 1 } });
        sse(res, "message_updated", { type: "message_updated", message: { ...msg("m2", "s2", "alice", "older reply (edited)") } });
        await later(20);
        res.destroy(); // the connection drops without a clean end
        return;
      }
      if (lastEventId === "s3") {
        // Resume: only additions after s3 are replayed; edits/deletes made
        // while away are not (they arrive only if they happen after reconnect).
        sse(res, "message_added", { id: "s4", type: "message_added", message: msg("m4", "s4", "herklos", "@specialist take m3") }, "s4");
        res.write("id: s4\n\n");
        sse(res, "message_deleted", { type: "message_deleted", message_id: "m2" });
        return; // held open until the client aborts
      }
      sse(res, "resync_required", { type: "resync_required" });
      res.end();
      return;
    }

    if (req.method === "POST" && /^\/v2\/spaces\/[^/]+\/search\/stream/.test(req.url ?? "")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      log.searchBodies.push(JSON.parse(raw));
      open();
      const task = (status: string) => ({ id: "t1", name: "Triage inbox", type: "task", properties: { status, assignee: "chief" } });
      sse(res, "object_added", { type: "object_added", space_id: "sp", object: task("Ready") });
      sse(res, "snapshot_complete", { type: "snapshot_complete", space_id: "sp" });
      await later(30);
      res.write(": keepalive\n\n");
      sse(res, "object_updated", { type: "object_updated", space_id: "sp", object: task("In progress") });
      sse(res, "object_removed", { type: "object_removed", space_id: "sp", object_id: "t1" });
      return;
    }

    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, log });
    }),
  );
}
