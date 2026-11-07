import { ReadableStream } from "node:stream/web";
import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse.js";

async function collect(frames: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  });
  const out = [];
  for await (const f of parseSse(stream as ReadableStream<Uint8Array>)) out.push(f);
  return out;
}

describe("T-WP1-04 SSE frame parsing", () => {
  it("handles frames split across chunks, CRLF, keepalive comments", async () => {
    const part1 = 'id: a1\r\nevent: message_added\r\ndata: {"x":1}';
    const part2 = "\r\n\r\n: keepalive\n\nid: a2\nevent: resync_required\ndata: {}\n\n";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(part1));
        controller.enqueue(enc.encode(part2));
        controller.close();
      },
    });
    const frames = [];
    for await (const f of parseSse(stream as ReadableStream<Uint8Array>)) frames.push(f);
    expect(frames.some((f) => f.kind === "comment")).toBe(true);
    expect(frames.some((f) => f.kind === "event" && f.event.type === "message_added")).toBe(true);
    expect(frames.some((f) => f.kind === "event" && f.event.type === "resync_required")).toBe(true);
  });

  it("dispatches id-only cursor frames", async () => {
    const frames = await collect("id: cursor-9\n\n");
    expect(frames).toEqual([{ kind: "cursor", id: "cursor-9" }]);
  });
});
