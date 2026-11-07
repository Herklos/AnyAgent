# WP1: backend port, reference backend, conformance suite, Anytype adapter

**Goal.** Everything anybot needs from a space goes through one tested interface, and an adapter for Anytype (anytype-heart through
`anytype serve`) passes that interface's conformance suite against a live instance. This package includes **spike 002**.

**Depends on:** WP0. **Unblocks:** WP2, WP5.

## Scope

In: promote the port, reference backend and suite from [spike 016](../../../spikes/016-backend-port-any/README.md), extend them for v0, build
`@anybot/backend-anytype`, run spike 002 and record what it finds.
Out: `backend-any` (later), the object stream and `search` for anything but listing `aa_agent` objects, files, discussions, push.

## Read first

[ADR 0017](../../adr/0017-anytype-backend-behind-a-port.md), [ADR 0004](../../adr/0004-typescript-over-the-http-api.md), [ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md),
[research/anytype-api.md](../../research/anytype-api.md) (routes, resumable chat stream, "Not yet verified"), [spikes/016](../../../spikes/016-backend-port-any/)
(`port.ts`, `memory-backend.ts`, `conformance.ts`, `any-backend.ts` as a worked adapter), [spikes/001-ts-sse](../../../spikes/001-ts-sse/) (SSE client and mock).

## Files

Create: `packages/backend/src/{port.ts,errors.ts,memory-backend.ts,queue.ts,index.ts}`, `packages/backend/src/conformance/{suite.ts,index.ts}`,
`packages/backend/test/memory.test.ts`, `packages/backend-anytype/src/{client.ts,adapter.ts,sse.ts,mapping.ts,index.ts}`,
`packages/backend-anytype/test/{mock-heart.ts,adapter.test.ts,live.test.ts}`, `packages/backend-anytype/test/fixtures/` (recorded responses),
`spikes/002-anytype-live/README.md`.
Change: `docs/research/anytype-api.md` (a "Verified live" section; move items out of "Not yet verified"), `docs/SPIKES.md` (002 result).
Must not change: `spikes/016-*` (copy from it, do not edit it; keep a provenance comment in each copied file).

## Port changes relative to the spike (do these first, with tests)

1. `ObjectRecord.body?: string`: the object's markdown body. `org.get(id)` fills it when the object has one; `org.list` never does.
   `objects.create` accepts a `body` too. An agent's instructions are its body ([ROADMAP v0](../../ROADMAP.md)).
2. `chat.create({ name }): Promise<string>` returns a new chat id (heart: `POST /v2/spaces/{s}/chats`).
3. Typed errors in `errors.ts`: `Unauthorized` (401/403: stop, do not retry), `Unavailable` (network, 5xx, 429: retry with backoff),
   `NotFound`, `Conflict`, `Unsupported` (the backend cannot do this: callers check capabilities first).
4. Capability names stay as in the spike. The Anytype adapter declares only what the live run proves.

## Steps

1. **Promote.** Copy `port.ts`, `queue.ts`, `memory-backend.ts`, `conformance.ts` from the spike into `packages/backend`, split the suite out of the
   test runner (`runConformance(ctx)` returns results; the vitest file turns each into a test). Apply the port changes above to the port,
   the reference backend and the suite (new checks: body read, `chat.create`, error mapping through a fault hook). Keep every spike check.
2. **Test the suite itself.** Reproduce the spike's mutation checks: a backend that ignores the resume cursor, and one that does not
   de-duplicate live events against catch-up, must each make a named check fail for the right reason (not a setup error).
3. **Spike 002 (needs `anytype-cli`; use only throwaway accounts and a throwaway space).** Install `anytype-cli`, create a bot account, join a
   test space by invite, create a read-write key and a read-only key, start `anytype serve`. Then answer and record, with the request, the response
   and the date: (a) key scopes and `GET /v2/auth/whoami`; (b) `GET /v2/spaces/{s}/members/me` and whether it carries a role; (c) the chat
   message stream: frames, ids, `Last-Event-ID` resume, `resync_required`; (d) `?reactions=full` and the reaction toggle; (e) the search stream
   frame names; (f) whether the streams are enabled in `anytype serve` (`StreamDisabled`, `SearchStreamDisabled`) and what happens when not;
   (g) `POST /v2/spaces/{s}/chats` (can a chat be created, with what fields); (h) how an object's markdown body is read; (i) whether an object
   shows who last modified it (this decides WP2's config check); (j) type and property creation. Save the traffic as fixtures
   (redact keys, space ids and names). Write the results into `docs/research/anytype-api.md` and `spikes/002-anytype-live/README.md`, including what was **not** proven.
4. **Mock.** Build `test/mock-heart.ts` from spike 001's mock and the fixtures so CI exercises the adapter without a live instance.
5. **Adapter.** `client.ts`: `fetch` with `Authorization: Bearer <key>` and the version header the live run shows, typed errors, timeouts,
   backoff on `Unavailable`. `sse.ts`: reuse spike 001's frame parser; resume from the stored event id. `mapping.ts`: heart objects and messages
   to port records (relations are ids, selects are strings, message `creator` is the participant id). `adapter.ts`: implement the port.
   Chat `events.watch` resumes with the last event id; on `resync_required` it re-reads recent history and emits `upsert` for messages newer than the
   cursor. A chat watch with no cursor emits nothing before `ready`. Objects `watch` emits the current state as `upsert`, then live changes (no
   replay). `react(on)` reads then toggles. Capabilities: declare `resume-cursor` only if (c) passed; never declare `agent-envelope` unless (c)/(h) show it.
6. **Conformance.** Run the suite against the adapter on the mock (CI) and live (opt-in `ANYBOT_LIVE_ANYTYPE=1`). Checks that need a missing capability are
   skipped with the reason; every check without a `needs` must pass.
7. **If a live Anytype is not available:** build everything against the research document and the mock, mark the adapter `verified: false` in its
   exported metadata, make `doctor` (WP7) print that, and record in STATUS.md that WP1 is `done (live NOT RUN)`. WP8 cannot pass without a live run.

## Tests

- T-WP1-01 the reference backend passes the full suite (all checks, including the new ones).
- T-WP1-02 the two mutation backends are caught, for the right reason.
- T-WP1-03 adapter vs mock: the full suite, ungated checks must pass.
- T-WP1-04 SSE: frames split across chunks, CRLF, keepalive comments, `resync_required`, a dropped socket resumed from the last id with no duplicates.
- T-WP1-05 error mapping: 401 and 403 become `Unauthorized`, 429 and 5xx become `Unavailable`, a refused connection becomes `Unavailable`.
- T-WP1-06 `org.get` returns the body; `chat.create` returns a usable chat id.
- T-WP1-07 (live, opt-in) the adapter passes the suite on a real `anytype serve`.

## Checks

```bash
pnpm --filter @anybot/backend test                    # expect: all pass
pnpm --filter @anybot/backend-anytype test            # expect: all pass, live skipped with a printed reason
ANYBOT_LIVE_ANYTYPE=1 pnpm --filter @anybot/backend-anytype test   # expect: live suite passes (or NOT RUN with reason)
pnpm check
```

## Achievements

- [ ] One port, one reference backend and one conformance suite in `@anybot/backend`, with the suite shown to fail on broken backends.
- [ ] `@anybot/backend-anytype` passes the suite on the mock, and live if an instance was available.
- [ ] Spike 002's ten questions are answered in `docs/research/anytype-api.md` with sources, and what was not proven is stated.
- [ ] No secrets, space ids or names in fixtures.

## Stop and ask when

Heart's streams are disabled in the available `anytype serve` and polling would be needed (decide: poll, or stop); a chat cannot be created through the API;
the body cannot be read through the API; the live behaviour contradicts [ADR 0017](../../adr/0017-anytype-backend-behind-a-port.md) or the port's resume contract.
