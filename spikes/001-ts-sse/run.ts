// Runs the TypeScript SSE client against the mock heart and checks every
// behaviour anybot needs from a realtime Anytype feed. Exit code 0 = all pass.
//   node spikes/001-ts-sse/run.ts

import assert from "node:assert/strict";
import { startMockHeart } from "./mock-heart.ts";
import { subscribe, StreamRefused, type SseEvent } from "./sse.ts";

const TOKEN = "test-token";
const { server, url, log } = await startMockHeart(TOKEN);
const auth = { Authorization: `Bearer ${TOKEN}` };
const results: string[] = [];
const pass = (name: string) => results.push(`PASS ${name}`);

try {
  // 1. Chat stream: history window, cursor frame, live events, drop, resume.
  {
    const ctrl = new AbortController();
    const events: SseEvent[] = [];
    const cursors: string[] = [];
    let comments = 0;
    const seen = new Set<string>(); // dedupe on message id (v2 may send a message twice)
    const lastId = await subscribe({
      url: `${url}/v2/spaces/sp/chats/ch/messages/stream?limit=25&heartbeat=1`,
      headers: auth,
      resumable: true,
      signal: ctrl.signal,
      backoff: { initialMs: 20, maxMs: 100 },
      onCursor: (id) => cursors.push(id),
      onComment: () => comments++,
      onEvent: (e) => {
        events.push(e);
        const body = JSON.parse(e.data);
        if (e.type === "message_added" && !seen.has(body.message.id)) seen.add(body.message.id);
        if (body.message?.id === "m4") ctrl.abort(); // done once the resumed addition arrives
      },
    });
    assert.deepEqual(
      events.map((e) => `${e.type}:${e.id ?? "-"}`),
      ["message_added:s2", "message_added:s1", "message_added:s3", "reactions_updated:-", "message_updated:-", "message_added:s4"],
    );
    pass("chat: every frame type parsed, ids only on additions");
    assert.deepEqual(cursors, ["s2"]);
    pass("chat: id-only cursor frame moves the resume point without an event");
    assert.equal(JSON.parse(events[2]!.data).message.text, "@chief please triage the inbox ⚓");
    pass("chat: CRLF endings and a frame split across chunks (incl. UTF-8) reassembled");
    assert.ok(comments >= 1);
    pass("chat: `: keepalive` comments surfaced as heartbeats");
    assert.deepEqual(log.chatConnects.map((c) => c.lastEventId), [null, "s3"]);
    pass("chat: reconnect after a dropped socket sent Last-Event-ID: s3 (newest addition, not the edit)");
    assert.equal(lastId, "s4");
    assert.deepEqual([...seen], ["m2", "m1", "m3", "m4"]);
    pass("chat: final cursor s4, no duplicate deliveries");
  }

  // 2. Unknown resume point -> resync_required.
  {
    const ctrl = new AbortController();
    const types: string[] = [];
    await subscribe({
      url: `${url}/v2/spaces/sp/chats/ch/messages/stream`,
      headers: auth,
      resumable: true,
      lastEventId: "stale",
      signal: ctrl.signal,
      backoff: { initialMs: 10, maxMs: 10 },
      onEvent: (e) => {
        types.push(e.type);
        ctrl.abort();
      },
    });
    assert.deepEqual(types, ["resync_required"]);
    pass("chat: stale Last-Event-ID yields resync_required (caller re-reads history)");
  }

  // 3. Object search stream: a POST with a JSON body, which EventSource cannot send.
  {
    const ctrl = new AbortController();
    const seen: string[] = [];
    await subscribe({
      url: `${url}/v2/spaces/sp/search/stream`,
      method: "POST",
      headers: auth,
      body: { types: ["task"], filters: { property: "status", condition: "not_empty" } },
      signal: ctrl.signal,
      onEvent: (e) => {
        const body = JSON.parse(e.data);
        seen.push(`${e.type}:${body.object?.properties?.status ?? body.object_id ?? ""}`);
        if (e.type === "object_removed") ctrl.abort();
      },
    });
    assert.deepEqual(seen, ["object_added:Ready", "snapshot_complete:", "object_updated:In progress", "object_removed:t1"]);
    assert.deepEqual(log.searchBodies[0], { types: ["task"], filters: { property: "status", condition: "not_empty" } });
    pass("objects: POST search stream gives snapshot, then live Task status changes");
  }

  // 4. A bad key is fatal, not retried forever.
  {
    await assert.rejects(
      subscribe({ url: `${url}/v2/spaces/sp/chats/ch/messages/stream`, headers: { Authorization: "Bearer wrong" }, onEvent: () => {} }),
      (e: unknown) => e instanceof StreamRefused && e.status === 401,
    );
    pass("auth: 401 stops the subscription instead of retrying");
  }
} finally {
  server.closeAllConnections();
  server.close();
}

console.log(results.join("\n"));
console.log(`\n${results.length} checks passed`);
