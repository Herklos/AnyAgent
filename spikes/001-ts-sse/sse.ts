// A dependency-free Server-Sent Events client for Node 22+, written for the
// Anytype JSON API v2 streams. It exists to answer one question: can a
// TypeScript process receive Anytype's realtime events exactly as a Go one can?
//
// Why not the browser/`eventsource` EventSource: the object search stream is a
// POST with a JSON body, and every stream needs an `Authorization: Bearer`
// header. EventSource can do neither, so this reads the body of a `fetch`.
//
// Parsing follows the WHATWG SSE processing model, which is what heart relies
// on (see heart core/api/v2/handler/chat_stream.go, writeCursor):
//   - `id:` sets the last-event-id buffer as soon as it is parsed, even when the
//     frame has no data. Heart's trailing "cursor" frame (`id: <max>\n\n`) moves
//     the resume point without dispatching an event.
//   - a frame with an empty data buffer dispatches nothing.
//   - lines starting with `:` are comments (heart sends `: keepalive`).

export interface SseEvent {
  /** Event type from the `event:` line (`message` when absent). */
  type: string;
  /** The joined `data:` lines. */
  data: string;
  /** The `id:` of this frame, if it carried one. */
  id?: string;
}

export type SseFrame =
  | { kind: "event"; event: SseEvent }
  | { kind: "cursor"; id: string }
  | { kind: "comment"; text: string };

/** Turns a byte stream into SSE frames. Handles CRLF, CR and LF line endings and
 * chunks that split a line or a multi-byte character anywhere. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let dataLines: string[] = [];
  let type = "";
  let id: string | undefined;

  const dispatch = (): SseFrame | undefined => {
    let frame: SseFrame | undefined;
    if (dataLines.length > 0) {
      frame = { kind: "event", event: { type: type || "message", data: dataLines.join("\n"), id } };
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
      // Split on any line ending; keep the last partial line in the buffer.
      // A trailing "\r" might be the first half of "\r\n", so hold it back.
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
        // `retry` and unknown fields are ignored on purpose: the caller owns backoff.
      }
      if (done) return; // an unterminated final frame is discarded, per the spec
    }
  } finally {
    reader.releaseLock();
  }
}

export interface SubscribeOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** JSON body (POST streams such as /v2/spaces/{id}/search/stream). */
  body?: unknown;
  /** Send `Last-Event-ID` on (re)connect. Only the chat message stream resumes. */
  resumable?: boolean;
  /** Resume point to start from (a chat state id persisted earlier). */
  lastEventId?: string;
  signal?: AbortSignal;
  backoff?: { initialMs: number; maxMs: number };
  onEvent: (event: SseEvent) => void | Promise<void>;
  onCursor?: (id: string) => void;
  onComment?: (text: string) => void;
  onOpen?: (info: { attempt: number; lastEventId?: string }) => void;
  onDisconnect?: (info: { attempt: number; error?: unknown }) => void;
}

/** Thrown for answers that retrying cannot fix (401, 403, 404, 400). */
export class StreamRefused extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`stream refused: HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

const FATAL = new Set([400, 401, 403, 404]);

/** Holds a stream open, reconnecting with backoff, until `signal` aborts or the
 * server refuses it. Resolves with the last event id seen. */
export async function subscribe(opts: SubscribeOptions): Promise<string | undefined> {
  const { initialMs, maxMs } = opts.backoff ?? { initialMs: 500, maxMs: 30_000 };
  let lastEventId = opts.lastEventId;
  let delay = initialMs;
  for (let attempt = 1; !opts.signal?.aborted; attempt++) {
    try {
      const headers: Record<string, string> = { Accept: "text/event-stream", ...opts.headers };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.resumable && lastEventId) headers["Last-Event-ID"] = lastEventId;
      const res = await fetch(opts.url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        if (FATAL.has(res.status)) throw new StreamRefused(res.status, text);
        throw new Error(`HTTP ${res.status}`); // 429, 5xx: retry with backoff
      }
      opts.onOpen?.({ attempt, lastEventId });
      delay = initialMs; // a successful open resets the backoff
      for await (const frame of parseSse(res.body)) {
        // Frames already buffered in the same chunk must not reach a consumer that aborted.
        if (opts.signal?.aborted) break;
        if (frame.kind === "comment") opts.onComment?.(frame.text);
        else if (frame.kind === "cursor") {
          lastEventId = frame.id;
          opts.onCursor?.(frame.id);
        } else {
          if (frame.event.id !== undefined) lastEventId = frame.event.id;
          await opts.onEvent(frame.event);
        }
      }
      opts.onDisconnect?.({ attempt });
    } catch (error) {
      if (error instanceof StreamRefused) throw error;
      if (opts.signal?.aborted) break;
      opts.onDisconnect?.({ attempt, error });
    }
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxMs);
  }
  return lastEventId;
}
