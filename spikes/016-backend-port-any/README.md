# Spike 016: the backend port against `any`

**Question.** Can everything anybot needs from its backend sit behind one small port
([ADR 0017](../../docs/adr/0017-anytype-backend-behind-a-port.md)), and does a local `any` server
([anyproto/any](https://github.com/anyproto/any) @`0b73c01`, developer preview) satisfy that port?

**Answer.** Yes, for one account on one machine. The port has five areas (identity, org, objects, chat, events). A
conformance suite of 17 checks passes against a real `any` server and against an in-memory reference
implementation, and fails on deliberately broken backends. Several things about `any` differ from what the
specification assumed from Anytype's API; they are under *Findings*.

## Run

The reference backend and the "suite can fail" check need nothing:

```bash
node spikes/016-backend-port-any/run.ts
```

Node 22.18+ (type stripping), no dependencies. Types are also checked with `tsc --strict`:

```bash
tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions \
  --skipLibCheck --types node spikes/016-backend-port-any/*.ts
```

To run against `any`, use a **throwaway network**, never Anytype's production one: `any` joins the production network
unless told otherwise, and a script that forgets this creates real spaces under a real account
(`website/02-quickstart/networks.md`). `run.ts` refuses to start unless the server reports exactly the network id you
name in `ANY_SPIKE_ALLOW_NETWORK_ID`.

```bash
git clone https://github.com/anyproto/any.git && cd any && git checkout 0b73c01
GOTOOLCHAIN=go1.26.2 go build -o /path/to/any ./cmd/any      # go.mod wants Go 1.26.2; no llama.cpp tag, so no local embedder

mkdir sandbox && cp internal/config/nodeconf-placeholder.yml sandbox/nodeconf.yml
cat > sandbox/config.yaml <<EOF
network: {nodeconfPath: $PWD/sandbox/nodeconf.yml}   # a real network id with fake peers: nothing can sync
p2p: {enabled: false, global: {enabled: false}}      # no LAN discovery, no relays
push: {enabled: false}
index: {embedder: none}
EOF
export ANY_DATA_DIR=$PWD/sandbox/data ANY_NETWORK_NODECONF_PATH=$PWD/sandbox/nodeconf.yml ANY_INDEX_EMBEDDER=none
/path/to/any init --config sandbox/config.yaml      # prints a recovery phrase for a throwaway account
/path/to/any run  --config sandbox/config.yaml &    # 127.0.0.1:2046

ANY_SPIKE_ALLOW_NETWORK_ID=$(awk '/networkId/{print $2; exit}' sandbox/nodeconf.yml) \
  node spikes/016-backend-port-any/run.ts
```

## What it is

| File | Role |
| --- | --- |
| `port.ts` | The port: `identity`, `org`, `objects`, `chat`, `events`, plus `SchemaAdmin`. Capabilities, opaque cursors, errors. ~175 lines. |
| `schema.ts` | Four `aa_*` types as data (`aa_prompt`, `aa_agent`, `aa_group`, `aa_task`), a slice of [schema.md](../../docs/specs/schema.md). |
| `conformance.ts` | 17 checks. It imports only the port and the schema, and asks backends for capabilities, never their names. |
| `any-backend.ts` | The adapter for `any`'s HTTP API. ~560 lines, reusing [spike 001](../001-ts-sse/)'s SSE parser. |
| `memory-backend.ts` | A second implementation, so the suite is shown to test the port and not `any`. |
| `run.ts` | Runs the reference backend, a mutation check, then `any`. |

## Result (2026-11-07, `any@0b73c01`, Go 1.26.2, Node 22.23.4)

```
== memory (reference implementation)      -- 16 passed, 0 failed, 1 skipped   (the skipped check needs a fault injector)
== mutation: a backend that replays everything on resume
PASS the resume check fails on it, for the right reason
== any (anyproto/any, local server, placeholder network)
-- 17 passed, 0 failed, 0 skipped
capabilities: resume-cursor, removal-resume, field-versions, roles, agent-envelope
```

The server was on network `N9DU6hLk…` (the placeholder) with `networkPeers`, `localPeers` and `globalPeers` all 0 and
p2p disabled, read from `GET /v1/spaces/{id}/sync-status` and `GET /v1/debug/p2p` after the run. Nothing left the
machine.

**The suite can fail, and the runs say so.** The first mutation check passed for the wrong reason (it failed on a
missing schema, not on the bug); that was fixed to require the resume assertion. Then the adapter itself was mutated
in scratch copies and run on the real server:

| Mutation of the adapter | Result |
| --- | --- |
| resume from `_applySeq >= cursor` instead of `>` | 3 checks fail (chat resume, fault, objects resume) |
| drop the de-duplication of live events against the catch-up | **all 16 then-existing checks still passed**; the race between opening the stream and finishing the catch-up was untested |
| same, after adding `events (chat, race)` | that check fails in 3 of 3 runs, and passes on the real adapter in 3 of 3 runs |

## Findings

Each is observed on the live server unless it cites a document. Paths are in `anyproto/any@0b73c01`.

1. **Resume works, and better than a message cursor.** Streams have no replay: "There is no replay across
   reconnects" (`docs/04-events.md`). But every record carries `_applySeq`, "the SDK's per-space, peer-local,
   monotonic apply counter, advanced by every apply that mutates the space's records" (`docs/13-index.md`, *ApplySeq
   semantics*), and it is filterable and sortable. Querying `_applySeq > cursor` with `includeDeleted: true` returned
   new messages, edits, reactions and tombstones (`_deletedAt`) in one ordered pass. The adapter opens the stream
   first, catches up, then drains live events dropping anything at or below the cursor; a cut stream reconnects from
   its own cursor and delivered the in-between messages once (fault check, with the injector asserting it cut at least
   one stream).
2. **An `aa_group` can be its chat.** A type with a `chat` part (`POST /types/{id}/parts`, body
   `{"key":"chat","ui":{"type":"chat"},"datasets":[{"module":"chat"}]}`) makes every object of that type its own
   conversation (`docs/03-api.md`, *Parts and modules*). Posts to two group objects and the general chat stayed
   separate. So the schema's `aa_group.chat_id` is the object itself on `any`; on Anytype it is a relation to a chat.
   The port hides this: the chat id is the group's id on one backend and a looked-up id on the other.
3. **No server-side compare-and-set on property writes.** `ifVersion` exists only on the document body routes
   (`docs/03-api.md` ~1694–1756). Property values merge per field. The adapter gives each field's `_ver` token
   (`fieldVersions`) and refuses a stale `expect` by reading first, which is **not atomic**, so the port does not
   claim `atomic-update`. Anything that must be serialised (task claims, [ADR 0006](../../docs/adr/0006-coordination-hierarchy-with-opt-in-claims.md))
   already goes through the lead's workflow, so this costs nothing. It is the `any` counterpart of
   [Q7](../../docs/OPEN-QUESTIONS.md) (can Anytype alone ever serialise anything?): on `any`, no.
4. **Reactions are a toggle**, not set/unset (`POST …/reactions/{emoji}`). The port promises an end state, so the
   adapter reads then toggles; two racing toggles by the same identity could flip twice. An unset leaves
   `reactions: {"👀": {}}` behind, which the adapter drops.
5. **Agents are first-class in chat.** `agent: {name, done, debugLink?, outcome?}` is a create-only envelope; `done`
   is required and "every run must end with a `done: true` message". A `control: {kind: "break", hard?}` message
   asks the run in flight to stop and carries no content (`docs/03-api.md`, *Message wire shape*). Both round-tripped.
   `control` is a ready-made interrupt signal for what the harness lacks ([ADR 0010](../../docs/adr/0010-reuse-michel-adapters-and-the-npm-harness.md)).
6. **Identity lines up.** The account id from `GET /health`, the `creator` stamped on messages, and a member's
   `identity` in `GET /members/me` were the same string. `permission` is `owner|admin|writer|reader|guest|none`, and a
   member has a role only while `status` is `active`.
7. **Property ids are content-addressed.** Values live at `record[typeId][propId]`, and `xKey` is only a handle, so the
   adapter lists definitions to translate `aa_*` keys. `ensureSchema` ran twice without duplicating anything.
   Relations are `any://<objectId>` URIs and a select is a one-element array of option keys; the port exposes plain
   object ids and strings.
8. **The local API has no authentication** ("the server binds to loopback and does not authenticate callers",
   README). One server is one account, which matches [ADR 0005](../../docs/adr/0005-identity-agents-map-to-accounts.md)
   (one account per agent or per pool), but the gateway must run on that machine or through a tunnel it controls.
9. **Smaller facts.** Records carry `modifiedBy` and `author`; with one account that cannot show *whose* edit it is
   (spike 005 stays open). Space creation returns push keys in its response. This build reports `state: "syncing"`
   with zero peers on the placeholder network, where `networks.md` says `offline`. The build needs Go 1.26.2, took
   about 70 s and produced an 81 MB binary.

## What this did not prove

- **A second author.** One account only: no other identity's reactions or messages, so no real approver check, no
  loop guard against another agent, no roles other than the owner's. This needs two servers on one throwaway network.
- **Sync.** Nothing synced; the network has no reachable peer. `_applySeq` is peer-local, and what a cold restore
  or a re-sync does to it is untested. A cursor must be dropped, and the watcher resynchronised from a full read, if
  the data directory is replaced.
- **Removals of objects while the watcher is down.** The `removal-resume` capability was tested for chat messages
  (tombstones). The docs say an object delete purges the row, so an object removed during a gap probably cannot be
  reported by a cursor. Unverified; the gateway's reconciler must diff.
- **Anything about anytype-heart.** That is [spike 002](../../docs/SPIKES.md); the same suite should then run
  against a heart adapter, which is the point of the port.
- **The whole schema.** Four types, no dates, no editor bodies (`aa_prompt` text is a field here, not a document), no
  collections or views, no mentions, no files, no paging beyond 200 objects (the adapter throws instead).
- **Vector search**, local embeddings, throughput, long chats, restarts of the server, or `any`'s stability: it is a
  developer preview whose "APIs and data formats can change without migration".
