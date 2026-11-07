# Spike 002: live `anytype serve` against the backend port

**Question.** Do the ten live questions in [WP1](../../docs/roadmap/v0/WP1-backend.md) hold against a real
`anytype serve` (bot account, throwaway space, read-only and read-write keys)?

**Answer (2026-11-07).** **NOT RUN** in this environment: no `anytype-cli` / `anytype serve` instance and no
throwaway network access were available to the implementing agent. The adapter is built against
[docs/research/anytype-api.md](../../docs/research/anytype-api.md) and the mock; `@anyagent/backend-anytype` exports
`meta.verified: false`.

## Procedure (when a throwaway instance is available)

1. Install `anytype-cli`, create a **bot** account, join a throwaway space by invite.
2. Create a read-write key and a read-only key; start `anytype serve`.
3. Record request/response/date for: (a) key scopes + `GET /v2/auth/whoami`; (b) `members/me` role;
   (c) chat message stream frames / `Last-Event-ID` / `resync_required`; (d) `?reactions=full`;
   (e) search stream frame names; (f) `StreamDisabled` / `SearchStreamDisabled`; (g) `POST …/chats`;
   (h) object markdown body read; (i) last modifier; (j) type and property creation.
4. Redact keys, space ids and names; save fixtures under `packages/backend-anytype/test/fixtures/`.
5. Run `ANYAGENT_LIVE_ANYTYPE=1 pnpm --filter @anyagent/backend-anytype test` and update
   `docs/research/anytype-api.md` "Verified live".

## What was not proven

Everything that needs a live heart process. Mock conformance does **not** prove heart framing, auth scopes, or stream
enablement flags.
