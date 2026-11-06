# The Anytype API, as anyagent uses it

Every fact below cites its source. Heart sources are read at commit
[`anyproto/anytype-heart@09bd4b5`](https://github.com/anyproto/anytype-heart/tree/09bd4b5) (2026-11-05). The
repository's default branch is `develop`; the same paths return 404 on `main`. Nothing here has been checked against a
live `anytype serve` yet ([SPIKES.md](../SPIKES.md) 002).

## Where the API runs

| Host | Port | Source |
| --- | --- | --- |
| Desktop app | `127.0.0.1:31009` (31007–31009) | anytype-cli README, "Network Configuration" |
| Headless `anytype serve` | `127.0.0.1:31012` (31010 gRPC, 31011 gRPC-Web, 31012 HTTP API) | anytype-cli README, same section |

- `--listen-address` changes the bind address and is remembered across logout (anytype-cli README).
- The server accepts only `Host` values of `localhost` or an IP address unless allowed in its environment (same README).
- The headless server "requires a dedicated bot account, which you create using `anytype auth create`… mnemonic-based
  login is not supported. The bot account only has access to spaces it explicitly joins" (anytype-cli README, line 31).
  One process is logged in to one account.
- OpenAPI at `GET /v2/docs/openapi.json` and `/v2/docs/openapi.yaml` (`core/api/server/router.go`, lines 147–148).

## Auth and keys

- Bearer API key. "Every key is limited to the spaces and permission you choose; there is no default." A key limited to
  specific spaces, or read-only, works with v2 only (anytype-cli README, "API Keys").
- "On v2, a key can only delete objects created under its name" (same section).
- `anytype auth apikey create <name> --space <id|name> --read-only` gives the gateway its least-privilege key.

## v2 routes anyagent needs

From `core/api/v2/router.go` (route registrations, lines 139–485):

| Purpose | Route |
| --- | --- |
| Who am I (key) | `GET /v2/auth/whoami` |
| Me in a space (participant) | `GET /v2/spaces/{space_id}/members/me` |
| Members | `GET /v2/spaces/{space_id}/members` |
| Objects | `GET/POST /v2/spaces/{space_id}/objects`, `GET/PATCH/DELETE …/objects/{object_id}` |
| Object discussion | `POST /v2/spaces/{space_id}/objects/{object_id}/discussion` |
| Search | `POST /v2/spaces/{space_id}/search` |
| **Object stream** | `POST /v2/spaces/{space_id}/search/stream` |
| Types, properties, templates, queries | `/v2/spaces/{space_id}/types`, `…/properties`, `…/templates`, `…/queries` |
| Chats | `GET/POST /v2/spaces/{space_id}/chats` |
| **Space chat stream** | `GET /v2/spaces/{space_id}/chats/stream` |
| Messages | `GET/POST /v2/spaces/{space_id}/chats/{chat_id}/messages`, `PATCH/DELETE …/messages/{message_id}` |
| **Chat message stream** | `GET /v2/spaces/{space_id}/chats/{chat_id}/messages/stream` |
| Reactions (toggle) | `POST …/messages/{message_id}/reactions` |
| Read marks | `POST …/chats/{chat_id}/read` |

**Streams can be switched off** in a build: the stream routes are registered only `if !deps.StreamDisabled` and the
search stream only `if !deps.SearchStreamDisabled` (`core/api/v2/router.go`, lines 231 and 292). anyagent must probe for
them at start.

## Chat message stream (resumable)

Source: `core/api/v2/handler/chat_stream.go`, `core/api/v2/model/chat_event.go`.

- Query: `limit` (opening window, default 25, 1–1000), `heartbeat` (seconds, default 30, 1–60). Header:
  `Last-Event-ID` (resume from a chat state id). Errors before the first byte: 404 space or chat, 429 too many streams.
- Order on connect: `resync_required` first if the resume point cannot be honoured; then the opening window as
  `message_added` events **in order-id order**; then **one id-only frame** `id: <max state id>` that moves the client's
  cursor "without inventing anything for the client to handle"; then live events; `: keepalive` comments.
- Event types: `message_added`, `message_updated`, `message_deleted`, `reactions_updated`, `state_updated`,
  `pinned_updated`, `resync_required`.
- The SSE `id:` is set **only on `message_added`** (the creation state id). Edits, pins and reactions carry none, so an
  edit cannot rewind a client's cursor (comments in `ChatEventFromProto`).
- A slow reader is dropped: the server writes `resync_required` and closes; "reconnecting with Last-Event-ID is the
  recovery".
- Frame format: `id: <id>\n` (optional) + `event: <type>\ndata: <json>\n\n`, in one write.
- Event JSON is flat: `{id?, type, message?, message_id?, reactions?, reacted_by?, state?, pinned?}`.

## Space chat stream (no replay)

Source: `core/api/v2/handler/chat_space_stream.go` (line 24): "Opens with a chat_added event per chat, then
snapshot_complete, then live chat, state and message events for every chat. Events carry no id and there is no replay:
keep the state_id of the newest message per chat and catch up a chat through its message stream with Last-Event-ID. A
message event can arrive twice; dedupe on its id."

## Object search stream

Source: `core/api/v2/handler/search_stream.go` (line 21) and `core/api/v2/service/search_stream.go`.

- `POST` with the space search body without `query`; nothing pages.
- "Opens with an object_added per matching object and snapshot_complete, then object_added, object_updated (a carried
  field or the discussion changed) and object_removed (left the set, not necessarily deleted). Events carry no id: a
  reconnect is a fresh snapshot."
- Event struct fields: `Type`, `SpaceId`, `Object` (a row with the requested fields), `ObjectId` (on removal),
  `Warnings` (on snapshot_complete). Their JSON names were not read; spike 001's mock assumes `type`, `space_id`,
  `object`, `object_id`, `warnings`.
- Because it is a `POST` with a body and needs `Authorization`, browser `EventSource` cannot open it; a `fetch` body
  reader can ([spike 001](../../spikes/001-ts-sse/)).

## Reactions

- Stream: `reactions_updated` carries **counts**; "ReactedBy carries participant ids and is populated only when the
  caller asked for them; the stream route has no such switch today, so it is always absent there"
  (`core/api/v2/model/chat_event.go`).
- Read: `GET …/messages?reactions=full` — "counts (default) returns the emoji counts; full adds the participant ids
  behind each count" (`core/api/v2/handler/chat.go`, line 146; model comment in `core/api/v2/model/chat.go`, line 7).
- Consequence for approvals: re-read the message with `?reactions=full` before accepting a decision
  ([ADR 0008](../adr/0008-approvals-objects-and-reactions.md)).

## MCP

Heart also serves MCP at `POST /mcp/{tier}` (`core/api/server/mcp.go`), request/response only. anyagent does not need
it for events. Agents may still use Anytype's MCP or HTTP API as a tool during their turns.

## Licence

anytype-heart: **Any Source Available License 1.0**, which grants use, modification and redistribution "only (a) for
Non-Commercial Use, or (b) for Commercial Use in Allowed Networks" (`LICENSE.md`, lines 7–9). anyagent calls the API
of a separately installed server and does not distribute heart ([ADR 0004](../adr/0004-typescript-over-the-http-api.md)).

## Not yet verified

- Whether chat access can be narrower than space membership (believed not: permissions are per space). Q6.
- Who authored an object edit (needed for approvals by object edit). Spike 005.
- That `expected_etag` is checked against the local copy only (inferred from the p2p design). Q7.
- Resident memory of one `anytype serve` (the cost of each account setup). Spike 003.
- Whether one account can run in two `anytype serve` instances at once (multi-device). Spike 010.
