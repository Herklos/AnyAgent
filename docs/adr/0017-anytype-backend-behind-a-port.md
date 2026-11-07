# ADR 0017: Build on Anytype (anytype-heart) behind a backend port; plan `any` as the second backend

- Status: **proposed**. The owner decides ([OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md) Q16).
- Date: 2026-11-07

## Context

The specification targets the Anytype JSON API v2 through `anytype serve`
([ADR 0004](0004-typescript-over-the-http-api.md), [research/anytype-api.md](../research/anytype-api.md)). In September 2026
Anytype's team announced **Anytwo**, a new product on a new database, `anyproto/any`. It is not the same codebase and
needs a hard migration from Anytype, with a bridge still to be built. Nearly all of the team moved to Anytwo. Anytype
stays available and still receives API v2. The evidence and its sources are in
[research/any-vs-anytype.md](../research/any-vs-anytype.md).

The options:

- **A.** Anytype only.
- **B.** `any` only.
- **C.** Anytype now, behind a port, with `any` planned as the second backend.

## Decision (proposed)

1. **C.** v0 runs on Anytype (anytype-heart through `anytype serve`). It is the only backend with released apps, and it
   is where people work today.
2. **A backend port.** Every access to the source of truth goes through one interface, in `packages/backend`:
   - `org` (read agents, groups, prompts, schedules, triggers, rules);
   - `events` (a resumable stream of chat and object changes, each with a cursor);
   - `chat` (post, edit, react);
   - `objects` (create, update with a version check, search);
   - `identity` (who wrote this, and which role they have in the space).

   The gateway, the workflows' activities and the node use only the port. The adapter for Anytype is `backend-anytype`.
3. **One backend per org.** An org (one space) runs on one backend. Accounts and spaces are not shared between the two
   products ([research](../research/any-vs-anytype.md), claims 4 and 12), so anyagent never bridges them. Moving an org
   is a migration: rebuild from the new space, with the same object ids where the bridge keeps them.
4. **Proving the seam** (rule 6): a conformance suite for the port runs against every adapter and against an
   in-memory reference. [Spike 016](../../spikes/016-backend-port-any/) wrote the first version and ran it against a
   local `any` server and the reference (17 checks passing, and failing on deliberately broken backends). The same
   suite must pass against a heart adapter (spike 002) before that adapter is accepted. A production `backend-any`
   is written when a signal in the research note fires: `any` leaves developer preview, Anytwo ships publicly, or
   the bridge ships.
5. **Schema stays semantic.** The `aa_*` schema ([ADR 0009](0009-new-minimal-versioned-schema.md)) describes types and
   fields, not heart's storage. Each adapter maps it to its backend's object model.

## What spike 016 showed about the port

Source: [spike 016](../../spikes/016-backend-port-any/README.md), one account on a local `any` server
(`anyproto/any@0b73c01`) on a network with no reachable peers.

- **The port's contract for events** is what both backends could keep: `watch(spec, {after?})` replays what changed
  since an opaque, comparable cursor (as `upsert`, and `removed` for chat), then signals `ready`, then streams live
  events; it reconnects by itself from its own cursor. The gateway stores that cursor. On `any` the cursor is
  `_applySeq`, which also covers edits and reactions. On Anytype it is whatever heart's resume offers (spike 002).
- **Optimistic writes** are a per-field version token plus a read-compare-write check, not a server-side
  compare-and-set. `any` has none for property writes, so the port does not offer `atomic-update` and nothing in
  anyagent may rely on it ([ADR 0006](0006-coordination-hierarchy-with-opt-in-claims.md) already serialises claims).
- **A group and its chat** are the same object on `any` (a type with a `chat` part) and two linked objects on
  Anytype. The port keeps them as a group id and a chat id.
- **Not proven:** a second author or approver, sync, object removals during a gap, anything on heart. See the spike.
- Until this ADR is accepted, [ADR 0011](0011-event-gateway.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) describe the
  Anytype adapter's behaviour (`Last-Event-ID`); the gateway will speak to the port.

## Consequences

- One more layer, small: the port has the five areas above and nothing else.
- Heart's thin maintenance is a risk for v0. A bug in the streams or the API may need a workaround in
  `backend-anytype`, or a fix offered upstream (the owner's call, as for Q14).
- Moving to `any` later changes one adapter and the setup of accounts, not the gateway or the workflows.
- Anytype people keep their apps. On `any`, they would use Anytwo.

## Extension points

- A backend is a registry entry with a conformance suite: `anytype`, later `any`.
- `any`'s extras (windowed subscriptions, roles, the chat `agent` envelope, vector search) are optional capabilities of
  the port. Code checks for a capability; it never checks which backend it has.

## Not generalised

- No sync or mirroring between two backends, and no org spanning both.
- No backend other than the two Anytype products.
