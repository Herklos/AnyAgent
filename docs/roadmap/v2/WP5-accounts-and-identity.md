# v2 WP5: accounts and identity resolution

**Goal.** Agents write through Anytype accounts that are objects, in any of three arrangements (one shared bot account, a pool, one account per agent, or a mix), and every message and approval is attributed correctly: a person is a person, an agent is the agent it claims to be only when its account says so, and an agent can never pass as a person or approve its own request.
This package completes **spike 011**.

**Depends on:** WP1. **Unblocks:** WP2, WP6, WP7.

## Scope

In: `aa_account` use, the node's account endpoints in configuration, the gateway's separate viewer key, the identity function, the handle tag, refusals that keep people and agents apart, the `account` CLI commands, `doctor`.
Out: creating Anytype accounts for people, automatic account provisioning, per-agent avatars and profiles (later), rotation of keys.

## Read first

[ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) (all of it), [ADR 0011](../../adr/0011-event-gateway.md) (decision 4: least privilege), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md), [specs/schema.md](../../specs/schema.md) (`aa_account`, `aa_agent`), [SPIKES.md](../../SPIKES.md) (011), WP1's schema, and from v1 `packages/core/src/{config.ts,author-policy.ts}`, `packages/node/src/worker.ts`.

## Files

Create: `packages/core/src/identity.ts` (the pure function), `packages/node/src/accounts.ts` (endpoint registry), `apps/cli/src/commands/account.ts`, tests, `docs/specs/identity.md`.
Change: `packages/core/src/{config.ts,agent-spec.ts,author-policy.ts}`, `packages/node/src/activities/*` (choose the backend by the agent's account), `packages/gateway/src/{supervisor.ts,pipeline.ts}` (viewer key, identity), `packages/admin/src/*` (refusals), `docs/specs/agent-workflow.md`.

## Configuration

```yaml
orgs:
  - id: work
    space: "<space id>"
    viewer:   { kind: anytype, url: "http://127.0.0.1:31012", keyEnv: WORK_VIEWER_KEY }     # read-only key; gateway only
    accounts:                                                                                 # accounts this node can write through
      - { handle: bots,  backend: { kind: anytype, url: "http://127.0.0.1:31012", keyEnv: WORK_BOTS_KEY } }
      - { handle: chief, backend: { kind: anytype, url: "http://10.0.0.5:31012",  keyEnv: WORK_CHIEF_KEY } }
```

A v0 or v1 file with `orgs[].backend` keeps working: it is read as one account `default` and as the viewer (and `doctor` warns that the read and write keys are the same).

## Behaviour

1. **Accounts are objects:** `aa_account` (`aa_handle`, `aa_participant_id`, `aa_tag_always`, `aa_lifecycle`). Each `aa_agent` links exactly one (`aa_account`). `anybot account add <handle> [--org id]` reads the participant id through that account's own key (`members/me`) and creates or updates the object. `account list` shows accounts, their participant ids and the agents using them.
2. **Endpoints are node configuration** (above). A turn on a node that has no endpoint for the agent's account is refused with the notice `This node has no endpoint for account <handle>.`; no write is attempted. Keys only by environment variable name.
3. **Identity function** `resolveAuthor({ authorId, text, accounts, agents })` (pure, spike 011), per [ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) decision 3:
   - the author id is not any `aa_account`'s participant id → `{ kind: "person" }`;
   - it is an account used by exactly one live agent → `{ kind: "agent", handle }` (a handle tag is optional and, if present, must match, else `unattributed-agent`);
   - it is an account shared by several live agents → the agent named by the **handle tag** (the first line is exactly `**@handle**`, the handle must be one of that account's agents); no or an invalid tag → `{ kind: "unattributed-agent" }`;
   - an account with no live agent → `unattributed-agent`.
   `unattributed-agent` messages are never routed and never count as human.
4. **Posting:** an agent always posts through its account's endpoint. A shared account's messages must start with `**@handle**`; an exclusive account adds the tag only if `aa_tag_always`. The node adds the tag; a harness never has to.
5. **People and agents never share an account.** An account linked by any `aa_agent` is an agent account. `init`, `migrate`, the gateway and `doctor` refuse an `aa_approvers` entry or an `aa_allowed_authors` entry (settings or group) that names an agent account: refused at write time by our own commands, ignored at run time by the gateway with a warning, and reported by `doctor`.
   "One account for all agents" therefore means one dedicated bot account, never the owner's personal account.
6. **The gateway reads with its own viewer key** (read-only). `doctor` checks the key's scope where the backend reports it (`whoami`) and warns when the gateway uses a key that can write. The gateway never needs an agent account's write key.
7. **Spoofing:** a person typing `**@chief**` as the first line of their own message is still a `person` (their account is not an agent account). A harness cannot choose another agent's tag: the node adds the tag, ignoring any tag in the reply text it did not add, and strips a leading tag line from the harness's text before adding its own.
8. **Mixed setups** are valid: some agents alone on an account, others sharing, others in a pool.

## Steps

1. `identity.ts` with the full table test first (spike 011 in full).
2. Config extension and the endpoint registry; the backward-compatible reading of v0 and v1 files.
3. `account add` and `account list`; the `agent create --account` flag; `aa_agent.aa_account` required from `0.3.0`.
4. Node: pick the backend by account; the notice; the tag logic.
5. Gateway: viewer key, identity in the pipeline, the refusals.
6. Tests for the three setups end to end with the reference backend (several backend instances, one per account).
7. `docs/specs/identity.md`.

## Tests

- T-V2-WP5-01 the identity table: person, owner as a person, exclusive agent (no tag, matching tag, wrong tag), shared account (valid tag, missing, invalid, a handle not on that account), an account with no live agent, a person typing a tag.
- T-V2-WP5-02 refusals: approvers, settings-level and group-level allowed authors naming an agent account are refused by `init` or `migrate`, ignored by the gateway with one warning, reported by `doctor`.
- T-V2-WP5-03 posting: shared account adds the tag; exclusive does not unless `aa_tag_always`; a harness reply that starts with a tag line has it replaced, not duplicated; a harness trying another agent's tag is overridden.
- T-V2-WP5-04 endpoints: a turn on a node without the endpoint is refused with the notice and writes nothing.
- T-V2-WP5-05 the three setups end to end (one account for all; two accounts in a pool; one per agent) and a mixed one: each reply is attributed to the right agent, routing works, nothing is attributed to a person.
- T-V2-WP5-06 `account add` reads the participant id through the account's own key and is idempotent.
- T-V2-WP5-07 config compatibility: a v0 file loads as one account plus the viewer; `doctor` warns about the shared key.
- T-V2-WP5-08 the gateway cannot write: with a read-only backend double, any write call fails the test.
- T-V2-WP5-09 (live, opt-in) the shared account and the per-agent setups on a throwaway space, with a second member as the person.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/node test && pnpm --filter @anybot/gateway test && pnpm --filter @anybot/admin test
pnpm check
```

## Achievements

- [ ] The three account setups, and a mix, work and attribute every message correctly.
- [ ] An agent can never be taken for a person, and an agent account can never approve or authorise anyone.
- [ ] The gateway holds only a read-only key.
- [ ] `docs/specs/identity.md` states the rules and the table.

## Stop and ask when

The backend cannot report a participant id for the account behind a key; a handle tag can be forged by a person in a way that makes a message count as an agent's (then the tag is not enough and a different attribution is needed); a shared account's messages cannot carry a first-line tag in the chat format.
