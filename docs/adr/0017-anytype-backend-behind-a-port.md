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
4. **Proving the seam** (rule 6): a conformance test suite for the port runs against spike 001's mock, and later
   against both adapters. `backend-any` is written when a signal in the research note fires: `any` leaves developer
   preview, Anytwo ships publicly, or the bridge ships. Spike 016 reads one org through `any` before that, to keep the
   port honest.
5. **Schema stays semantic.** The `aa_*` schema ([ADR 0009](0009-new-minimal-versioned-schema.md)) describes types and
   fields, not heart's storage. Each adapter maps it to its backend's object model.

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
