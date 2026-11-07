/**
 * Copied from spikes/001-ts-sse/sse.ts.
 * Licence: Apache-2.0 (same as anyagent).
 * Changes: export parseSse only path used by the adapter; keep StreamRefused.
 */

export interface SseEvent {
  type: string;
  data: string;
  id?: string;
}

export type SseFrame =
  | { kind: "event"; event: SseEvent }
  | { kind: "cursor"; id: string }
  | { kind: "comment"; text: string };

/** Turns a byte stream into SSE frames. Handles CRLF, CR and LF line endings. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let dataLines: string[] = [];
  let type = "";
  let id: string | undefined;

  const dispatch = (): SseFrame | undefined => {
    let frame: SseFrame | undefined;
    if (dataLines.length > 0) {
      const event: SseEvent = { type: type || "message", data: dataLines.join("\n") };
      if (id !== undefined) event.id = id;
      frame = { kind: "event", event };
    } else if (id !== undefined) {
      frame = { kind: "cursor", id };
    }
    dataLines = [];
    type = "";
    id = undefined;
    return frame;
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        if (match[0] === "\r" && match.index === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line === "") {
          const frame = dispatch();
          if (frame) yield frame;
          continue;
        }
        if (line.startsWith(":")) {
          yield { kind: "comment", text: line.slice(1).trimStart() };
          continue;
        }
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value_ = colon === -1 ? "" : line.slice(colon + 1);
        if (value_.startsWith(" ")) value_ = value_.slice(1);
        if (field === "data") dataLines.push(value_);
        else if (field === "event") type = value_;
        else if (field === "id" && !value_.includes("\0")) id = value_;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
