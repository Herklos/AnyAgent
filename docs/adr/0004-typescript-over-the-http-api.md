# ADR 0004: TypeScript, talking to Anytype over the HTTP/SSE API

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

Go was chosen first, then reconsidered when the owner asked whether Go was required to use Anytype. Findings:

- Go is required only to **embed** anytype-heart in-process. The public JSON API (HTTP + Server-Sent Events) is
  language-neutral. Anytype's own clients are not Go: the desktop app (`anyproto/anytype-ts`) is TypeScript and
  `anyproto/anytype-mcp` is TypeScript.
- anytype-heart is licensed under **Any Source Available License 1.0**, which grants use, modification and
  redistribution "only (a) for Non-Commercial Use, or (b) for Commercial Use in Allowed Networks" (heart `LICENSE.md`,
  lines 7–9). Embedding heart would carry that clause into every anyagent build. Talking HTTP to a separately installed
  `anytype serve` keeps heart out of anyagent's distribution. (A reading of the text, not legal advice.)
- The realtime API is reachable from TypeScript exactly as from Go: [spike 001](../../spikes/001-ts-sse/) consumes both v2
  streams (chat and object search) with Node 22 `fetch`, including the POST stream that `EventSource` cannot open.
- Temporal's TypeScript SDK is first class, and Michel's harness adapters are TypeScript
  ([ADR 0010](0010-reuse-michel-adapters-and-the-npm-harness.md)).

## Decision

anyagent is written in **TypeScript** (Node 22+, pnpm workspace, Vitest, Biome as in Michel). It talks to Anytype only
through the public **JSON API v2 over HTTP and SSE**, to an `anytype serve` (headless CLI, port 31012) or the desktop
app (port 31009) run separately.

## Consequences

- No dependency on heart's internal gRPC services, which change more often than the versioned JSON API.
- One extra local process per node (`anytype serve`) and one HTTP hop per call.
- v2 streams can be disabled in a heart build (`StreamDisabled`, `SearchStreamDisabled` in
  `core/api/server/router.go`); the node must detect this at start and refuse to run without them.

## Extension points

- `AnytypeClient` port: an embedded-heart implementation can be added later if the licence and the API allow it.

## Not generalised

- No gRPC client, no v1 API support (v1 has no `Last-Event-ID` resume and no object stream).
