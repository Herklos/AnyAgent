# `any` / Anytwo and Anytype: which backend is the future?

Research for [ADR 0017](../adr/0017-anytype-backend-behind-a-port.md). Read 2026-11-07. Each claim is labelled
**stated** (the Anytype team said it), **observed** (code or commits show it) or **inferred** (our reading). A
separate research agent wrote a longer report from the brief in our session. That report is not in this repository, and
only the claims below were re-checked here.

## Summary

Anytype's team is building a **new product, Anytwo**, on a new database (`any`, also called AnytwoDB), and moving
almost the whole team to it. Anytwo is a different app, and moving to it is a **hard migration** with a bridge still to
come. Anytype (anytype-heart) stays available "forever" but gets less development: the team says one person keeps
working on it. It still receives API v2 and moves to the MIT licence.

For anyagent this means:
- Anytype is the only backend people can use today, and its apps are where people work now.
- Anytwo is where the platform's investment is going.

## Evidence

| # | Claim | Kind | Confidence | Source |
| --- | --- | --- | --- | --- |
| 1 | Anytwo was announced at the Town Hall of 10 September 2026 | stated | high | [community.anytype.io/t/31235](https://community.anytype.io/t/anytwo-and-the-future-of-anytype/31235), opening post by `kaye`, 2026-09-11 |
| 2 | "The legacy, complex Middleware layer has been completely replaced with the our new Any Database" (for Anytwo) | stated | high | same post |
| 3 | "Anytwo is not the same codebase as Anytype, it is not the same product. But it does share some layers underneath, such as any-sync, any-store" | stated | high | same thread, page 3, `kaye`, 2026-09-12 |
| 4 | "if you want to use the new build, you will need to commit to a hard migration from Anytype. We will build a bridge" | stated | high | opening post. No date for the bridge is given |
| 5 | "You can continue to use Anytype forever, it's not going anywhere"; "Development pace will slow down because we're focusing on Anytwo" | stated | high | opening post |
| 6 | "Only one person is continuing to work on anytype, while the rest of the team is working on the new app" | stated | high | page 3, `anton`, 2026-09-12 |
| 7 | Still coming to Anytype: API v2 ("Whatever you can do as a user should be accessible through the API"), rollups, better search, formulas | stated | high | opening post |
| 8 | Anytype moves from source-available to MIT. Anytwo is planned to be source-available. AnytwoDB "will likely be some from of FOSS" | stated | medium | opening post; page 3 (`kaye`, `anton`). The team's statements are not fully consistent |
| 9 | `anyproto/any` is MIT, © 2026 Any Association, and a "developer preview" | observed | high | `anyproto/any@0b73c01` `LICENSE`, `README.md` |
| 10 | First public release of Anytwo "by the end of the year", without feature parity; "a safe commit" | stated | medium | opening post; page 3, `anton`. Not verified as shipped |
| 11 | Anytwo is built with Tauri | stated | medium | page 3, `anton` |
| 12 | `any` derives accounts at index 1, with index 0 reserved for Anytype: "one phrase can serve both products with two distinct accounts" | observed | high | `any@0b73c01` `website/06-auth/accounts.md:16`. The forum does not discuss accounts |
| 13 | `any` uses Anytype's production any-sync network and relays by default | observed | high | `any@0b73c01` `docs/02-server.md:356`, `docs/30-global-p2p.md:54` |
| 14 | The public iOS app is still on anytype-heart: middleware `v0.51.8-nightly.20261103.1`, bumped automatically about weekly through October and November | observed | high | `anyproto/anytype-swift@9115c1c` `Libraryfile`; `git log -- Libraryfile` |
| 15 | Each `any` release dispatches builds to `any-ui`, `anytype-swift` and `any-kotlin`; `any-ui` is not public (403) | observed | high | `any@0b73c01` `docs/18-ci.md:3-7,77`. Whether a public anytype-swift branch uses `any` was not checked here |
| 16 | Agent features: Anytwo ships an optional agent ("a model of your choice", "Turn off AI button"). anybao, any-agents and the chat `agent` envelope are on `any` | stated, observed | high | opening post; `anyproto/anybao@fb1de0f`, `anyproto/any-agents@a3302b0` |
| 17 | No converter from a heart space to an `any` space was found in public code | observed | medium | searched our clones of `any`, `anybao` and `any-agents`. The anybao "cutover" document concerns anybao's own parts |

Not found (searched 2026-11-07 in our clones, a web search and pages 1–4 of the thread; page 5 onward unread):
- any date for `any` leaving developer preview;
- any date for the bridge;
- any statement on whether Anytype and Anytwo accounts are linked;
- any MCP plan for Anytwo.

## Observed on a local `any` server (spike 016)

[Spike 016](../../spikes/016-backend-port-any/README.md) ran a 17-check suite against `any@0b73c01` on a throwaway
network: all passed. What it adds to the table above (observed, high confidence for one account, none for sync):

- the API is enough for anyagent's backend port: org reads, chat, agent envelope, reactions, live streams, and
  resume by a per-peer cursor (`_applySeq`) that also catches edits and reactions;
- it has no server-side compare-and-set on property writes, and no authentication on its loopback API;
- an `any` build needs Go 1.26.2 and about 70 s; it is a developer preview, so all of this can change.

## What this means for anyagent

- **Anytype today.**
  - It is the only backend people can use with released apps, and the one spike 002 tests.
  - Its API keeps getting work (claim 7). Its maintenance is thin (claim 6), so a bug in the API or the streams that
    anyagent depends on may stay unfixed for a long time.
  - The move to MIT (claim 8) removes the licence question for anything that embeds or patches it.
- **`any` later.**
  - It is the platform's direction (claims 2, 6, 16), and its API is already shaped for agents (windowed subscriptions,
    roles, an agent envelope in chat, vector search).
  - It does not share accounts with Anytype (claim 12). Without a bridge it does not share spaces either (claim 4).
  - So an org cannot run half on each: an org lives on one backend.
- **The seam.** Everything anyagent needs from the backend fits one port:
  - reading the org;
  - streaming events;
  - posting to chats and reacting;
  - creating and updating objects with a version check;
  - identity and roles.

  The gateway, the workflows and the harness adapters stay the same on either backend.

## Signals to watch

| Signal | Where |
| --- | --- |
| `any` drops "Developer preview" or tags 1.0 | `anyproto/any` README and tags |
| `any-ui` or `any-kotlin` becomes public, or Anytwo's first public release | github.com/anyproto, anytype.io |
| The Anytype→Anytwo bridge ships | the forum's News category, `anyproto` repositories |
| anytype-swift stops bumping heart, or merges an `any` backend | `anyproto/anytype-swift` `Libraryfile` history |
| Anytype's API v2 ships or stalls | `anyproto/anytype-heart` `core/api/v2`, release notes |
| anytype-heart licence becomes MIT | `anyproto/anytype-heart` `LICENSE.md` |
| Anytwo accounts and membership model decided | the forum thread, docs.any.org |
