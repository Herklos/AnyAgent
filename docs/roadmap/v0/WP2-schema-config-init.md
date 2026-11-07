# WP2: schema, configuration, `init`, `agent create`

**Goal.** A person can describe an org in a config file, run one command to create the `aa_*` schema in their space, and another to create an agent
with its own chat; and the program can read an agent back as a typed, validated spec. Includes **spike 009** (schema bootstrap) and a mini **spike 005**.

**Depends on:** WP0, WP1. **Unblocks:** WP6, WP7.

## Scope

In: configuration schema and loader, the v0 schema as data, agent spec parsing, the author policy, the `admin` library (`initOrg`, `createAgent`, `listAgents`).
Out: CLI wiring and help text (WP7), `aa_node`, `aa_account`, `aa_group`, `aa_prompt`, approvals (later releases), `anyagent migrate` beyond a version check.

## Read first

[specs/schema.md](../../specs/schema.md) (`aa_settings`, `aa_agent`), [ADR 0009](../../adr/0009-new-minimal-versioned-schema.md), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (person-only fields),
[ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md) (orgs list), [ADR 0003](../../adr/0003-one-shared-temporal-one-workflow-per-agent.md) (Temporal block), [ROADMAP v0](../../ROADMAP.md), and the WP1 results.

## Files

Create: `packages/core/src/{schema.ts,config.ts,agent-spec.ts,author-policy.ts,index.ts}`, `packages/core/test/*.test.ts`, `packages/admin/src/{init.ts,agent.ts,index.ts}`,
`packages/admin/test/*.test.ts`, `examples/anyagent.config.yaml`.
Change: `docs/specs/schema.md` (v0 field list, `aa_chat` as text), `docs/SPIKES.md` (009, 005).
Must not change: ADRs.

## The v0 schema (as data, `packages/core/src/schema.ts`, in the port's `TypeDef` format)

- `aa_settings` (one per space): `aa_schema_version` text (semver, v0 writes `0.1.0`).
- `aa_agent`: `aa_handle` text (`^[a-z][a-z0-9-]{1,30}$`, unique in the space); `aa_harness` select (`claude-code`, `codex`, `grok`); `aa_model` text (empty = harness default);
  `aa_chat` text (the chat object id; a text field, not a relation, to keep it simple; v2 adds groups); `aa_workdir` text (an absolute path on the node, inside `node.workdirRoots`; empty means a private directory under the state dir); `aa_approval_mode` select (`read_only` default, `full`);
  `aa_allowed_authors` text (comma-separated participant ids; empty means the space owner only); `aa_lifecycle` select (`live` default, `paused`).
  The **instructions are the object's body**.

## Configuration (`anyagent.config.yaml`, validated with zod; secrets only by environment variable name)

```yaml
version: 1
temporal: { address: "localhost:7233", namespace: "default" }    # tls, apiKeyEnv optional (ADR 0003)
state: { dir: "~/.anyagent" }                                    # SQLite files and per-agent homes
node: { handle: "my-laptop", workdirRoots: ["~"] }               # handle: lowercase, unique inside an org; roots bound each agent's aa_workdir
tuning: { turnTimeoutMin: 60, rotateAfterAccepted: 1500, maxMessageChars: 8000 }   # all optional
orgs:                                                            # a list from day one (ADR 0018); v0 is accepted with one
  - id: personal                                                 # a label for logs and the CLI
    backend: { kind: anytype, url: "http://127.0.0.1:31012", readKeyEnv: ANYAGENT_PERSONAL_KEY, writeKeyEnv: ANYAGENT_PERSONAL_KEY }
    space: "<space id>"
harnesses: {}                                                    # optional command overrides per harness id
```

Rules: unique org ids; `backend.kind` is `anytype` (an unknown kind is a clear error); `*Env` values name variables that must exist at `run` time (not at load time, so
`init --check` works offline); one key for both read and write is allowed (a `doctor` warning later); unknown keys are rejected.

## Steps

1. **Schema and spec (pure, tested first).** `schema.ts` as above. `agent-spec.ts`: `parseAgentSpec(record, body)` returns `{ ok: true, spec } | { ok: false, errors }` where `errors`
   name the field. `AgentSpec` has `handle, harness, model?, chatId, approvalMode, allowedAuthors[], lifecycle, instructions`. Reject unknown select values; a missing
   `aa_chat` or `aa_harness` is an error (the agent cannot run), a missing mode defaults to `read_only`.
2. **Author policy (pure).** `isAllowedAuthor({ spec, authorId, ownerIds })`: if `allowedAuthors` is empty, allowed only if `authorId` is in `ownerIds`; otherwise only if
   listed. The agent's own account is never allowed (loop guard). `ownerIds` come from the backend (members with role `owner`); if the backend gives no roles, the
   configuration must name them explicitly (`orgs[].owners`, an optional list of participant ids) or `init` fails with that message.
3. **Config loader.** `loadConfig(path)` returns the typed config, with `~` expanded and defaults applied; errors list every problem at once.
4. **Spike 009.** On the reference backend and, if WP1 had a live instance, on Anytype: create the two types and their properties through the port's `ensureSchema`, twice, and
   record that nothing duplicates, what the live API required (order, options), and anything the port could not express. Write the result in `docs/SPIKES.md`.
5. **`initOrg(backend, opts)`.** `ensureSchema`, then find or create the single `aa_settings` object and write `aa_schema_version`. If the space already has a **newer** version
   than this program supports, refuse with a clear message and change nothing. Idempotent: a second run changes nothing and says so. Return a report (what was created or already present).
6. **`createAgent(backend, opts)`.** Validate the handle (format, unique among existing `aa_agent`). Create a chat (`chat.create`), create the `aa_agent` object with its fields and a default
   body (a short instruction text the person is expected to edit, saying the agent answers questions about this machine and is read-only by default), and write the chat id into `aa_chat`.
   Return the ids. `listAgents(backend)` returns parsed specs and per-agent errors.
7. **Mini spike 005: who changed an agent?** Anyone with write access to the space can edit an `aa_agent` (for example set `full`, or add themselves to `aa_allowed_authors`). From the WP1
   results: does the backend show who last modified an object? If yes, `resolveConfig` (WP6) must refuse to run an agent whose settings were last changed by someone who is not an
   owner or an allowed author, with a notice; implement the pure check `lastModifierAcceptable(record, ownerIds, allowedAuthors)` and test it. If not, write the limitation in
   the getting-started guide (WP7) and make `doctor` print: "anyone with write access to this space can change this agent's settings; share the space only with people you trust."
   Record which case applies in `docs/SPIKES.md`.

## Tests

- T-WP2-01 config: valid file loads; duplicate org ids, unknown backend kind, unknown key, bad handle, missing `node.handle` each produce an error naming the problem; all errors are reported together.
- T-WP2-02 spec: valid record parses; each invalid case from step 1 names its field; defaults apply; the body becomes `instructions`.
- T-WP2-03 author policy table: owner default, explicit list, empty list with no owners, the agent's own account, a non-listed member.
- T-WP2-04 `initOrg` twice on the reference backend: second run reports no changes; a newer schema version is refused without writes.
- T-WP2-05 `createAgent`: object and chat exist, `aa_chat` points at the chat, duplicate handle is refused, invalid handle is refused.
- T-WP2-06 `listAgents` returns one valid and one broken agent with a per-agent error, without throwing.
- T-WP2-07 `lastModifierAcceptable` table (if the backend exposes the modifier), or the documented limitation exists.
- T-WP2-08 (live, opt-in) `initOrg` and `createAgent` on a real throwaway space, twice.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/admin test
ANYAGENT_LIVE_ANYTYPE=1 pnpm --filter @anyagent/admin test    # or NOT RUN with reason
node -e "import('@anyagent/core').then(m => console.log(m.loadConfig('examples/anyagent.config.yaml').orgs.length))"   # expect: 1
pnpm check
```

## Achievements

- [ ] The v0 schema exists as data and is applied idempotently through the port.
- [ ] A config file with one org (and the list shape for more) loads and validates, with every error reported.
- [ ] `createAgent` yields an agent that `listAgents` parses into a typed spec.
- [ ] The owner-only default and the "who changed it" question are both settled in code or in a recorded limitation.
- [ ] `docs/specs/schema.md` matches what was built.

## Stop and ask when

The backend cannot create the select options or the chat; a space already contains `aa_*` types with a different shape; the live run shows that body text cannot be written (instructions must be the body).
