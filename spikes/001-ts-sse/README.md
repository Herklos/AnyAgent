# Spike 001: Anytype realtime streams from TypeScript

**Question.** Can a TypeScript process receive Anytype's realtime events the same way a Go process can?

**Answer.** Yes. The realtime API is Server-Sent Events over HTTP. Go has no privileged access unless it embeds
anytype-heart in-process, which anyagent does not do ([ADR 0004](../../docs/adr/0004-typescript-over-the-http-api.md)).

## Run

```bash
node spikes/001-ts-sse/run.ts
```

Node 22.18+ (type stripping). No dependencies.

## What it is

- `sse.ts`: a dependency-free SSE client on `fetch` (GET and POST, `Authorization`, `Last-Event-ID`, reconnect with
  backoff, fatal on 400/401/403/404).
- `mock-heart.ts`: a mock of the two v2 streams anyagent uses, emitting heart's exact framing as read at
  `anyproto/anytype-heart@09bd4b5` ([research](../../docs/research/anytype-api.md)).
- `run.ts`: the checks.

## Result (2026-11-06, Node 22.23.4)

```
PASS chat: every frame type parsed, ids only on additions
PASS chat: id-only cursor frame moves the resume point without an event
PASS chat: CRLF endings and a frame split across chunks (incl. UTF-8) reassembled
PASS chat: `: keepalive` comments surfaced as heartbeats
PASS chat: reconnect after a dropped socket sent Last-Event-ID: s3 (newest addition, not the edit)
PASS chat: final cursor s4, no duplicate deliveries
PASS chat: stale Last-Event-ID yields resync_required (caller re-reads history)
PASS objects: POST search stream gives snapshot, then live Task status changes
PASS auth: 401 stops the subscription instead of retrying

9 checks passed
```

The first runs found two client bugs, both fixed: a parameter property that Node's type stripping rejects, and frames
buffered in the same chunk being dispatched after `abort()`.

## What it did not prove

- Nothing ran against a live `anytype serve` (spike 002).
- The JSON field names of search-stream events are inferred (`type`, `space_id`, `object`, `object_id`); the Go struct
  fields were read, their tags were not.
- Long-running behaviour (hours of keepalives, proxy idle timeouts) is untested.
