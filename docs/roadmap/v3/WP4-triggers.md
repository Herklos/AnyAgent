# v3 WP4: triggers

**Goal.** The outside world can wake an agent in three ways, a signed webhook, an Anytype object that matches a filter, or a chat message that matches a pattern, and none of them gives the sender any authority: payloads are untrusted data, secrets stay on the gateway, a trigger-woken turn can never run in `full`, and every delivery is idempotent.

**Depends on:** WP2 (`trigger.self`). **Unblocks:** WP6.

## Scope

In: the `aa_trigger` type, the gateway's webhook listener, signature checking, idempotency and replay limits, the `object_change` and `chat_pattern` sources, the source-kind registry, the prompt template, the `triggerFired` handler, the effective-mode cap, projections, `doctor`.
Out: other sources (email, RSS, a GitHub App: later, as registry entries), outbound webhooks, TLS termination (a reverse proxy does it; documented), a webhook management UI.

## Read first

[ADR 0011](../../adr/0011-event-gateway.md) (sources, pipeline, decision 4, 8), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (`trigger.self`, `aa_secret_ref` person-only), [specs/schema.md](../../specs/schema.md) (`aa_trigger`), [VISION.md](../../VISION.md) (principle 8), v1 WP4 (reconciler pattern), v2 WP2 (routing, so a message is not delivered twice), v2 WP4 (`objectChanged` keys and the self-change skip), WP2 here.

## Files

Create: `packages/core/src/trigger.ts` (spec, template, kinds), `packages/gateway/src/sources/{registry.ts,webhook.ts,object-change.ts,chat-pattern.ts}`, `packages/gateway/src/{secrets.ts,rate-limit.ts}`, `packages/node/src/activities/write-trigger-projection.ts`, tests, `docs/specs/triggers.md`, `docs/WEBHOOKS.md` (how to expose the endpoint safely).
Change: `packages/core/src/{schema.ts,schema-versions.ts,config.ts}` (`aa_trigger`; `gateway.webhooks`, `gateway.secrets`), `packages/workflows/src/{contracts.ts,anyagent-workflow.ts}` (`triggerFired`), `packages/gateway/src/{supervisor.ts,pipeline.ts}`, `apps/cli` (`trigger list`, doctor), `docs/specs/agent-workflow.md`.
Dependency: `re2` (a linear-time regular-expression engine), pinned exactly, for `chat_pattern`; if it cannot be installed on a target platform, fall back to running the match in a worker thread with a 50 ms limit and say so.

## Schema (additive, `0.4.0`)

`aa_trigger`: `aa_owner` (objects → `aa_agent`), `aa_trigger_kind` (`webhook`, `object_change`, `chat_pattern`), `aa_match` (text), `aa_secret_ref` (text, person-only: the **name** of a secret in the gateway config), `aa_enabled` (checkbox, person), `aa_last_fired` (date, node). Body: the prompt template; `{{payload}}` is replaced as below.

## Gateway configuration

```yaml
gateway:
  webhooks: { listen: "127.0.0.1:8088", maxBodyBytes: 1048576, ratePerMinute: 60 }
  secrets:                       # names referenced by aa_secret_ref; values only from the environment
    github-push: { env: HOOK_GITHUB_SECRET, header: "X-Hub-Signature-256", deliveryHeader: "X-GitHub-Delivery" }
    generic:     { env: HOOK_GENERIC_SECRET, header: "X-Signature", timestampHeader: "X-Timestamp", toleranceSeconds: 300 }
```

## Behaviour

1. **Registry:** a source kind is `{ kind, validate(match), start(trigger, emit) }`; the three kinds register themselves; adding one is a new file and an entry. The reconciler (v1 pattern) starts, updates and stops a source per enabled trigger as `aa_trigger` objects change.
2. **Webhook endpoint** `POST /hooks/<triggerId>` (only this route; everything else is 404): look up the trigger; unknown, disabled, wrong kind, or **no secret configured for its `aa_secret_ref`** (an *inert* trigger) answers **401** with no detail, the same as a bad signature. Check the body size first (**413**), then the rate limit (**429**), then the signature:
   HMAC-SHA256 over the **raw** body with the configured secret, compared in constant time, in the format of the configured header (`sha256=<hex>` or bare hex); if the secret config has a timestamp header, reject outside the tolerance (replay). Never log the body or the signature. Answer **202** only **after** the update to the owner's workflow has been accepted;
   **503** when Temporal is unavailable (the sender retries). The listener binds to loopback by default; `docs/WEBHOOKS.md` explains the reverse proxy and that this is the only port to expose beyond the private network.
3. **Idempotency:** the key is `hook:<triggerId>:<delivery id>` when the secret config names a delivery header and it is present, else `hook:<triggerId>:<sha256 of the body>`. A repeated key is acknowledged with 202 and runs nothing; kept 7 days like all keys.
4. **The prompt template:** the trigger's body with `{{payload}}` replaced by the payload (JSON re-serialised compactly, or text), **truncated to 8,000 characters, control characters stripped, wrapped in a delimited block** that the turn's instructions declare to be untrusted data from an outside sender (`<<<PAYLOAD … >>>`, with the delimiter escaped if it appears inside). The payload never reaches the instructions section.
5. **`triggerFired`** `{ key, triggerId, payload }` is admitted through the core's queue like any message.
6. **Effective mode cap (a safety rule):** a turn started by a trigger never runs in `full`: effective mode = `ask` if the agent is `full`; `read_only` and `ask` and `auto` stay as they are. A payload is untrusted; letting it drive a `full` agent would let a webhook sender run commands. The owner cannot override this in v3; `doctor` states it per trigger.
7. **`object_change`:** `aa_match` is a JSON search filter over the org's objects (validated, size-limited); the source watches matching objects and fires on `added` and `updated` (not `removed`); the payload is a short summary (type, name, id, link, the names of changed fields) and **never the object's body**; key `obj:<triggerId>:<objectId>:<version token>`; changes made by the owner agent's own account (the `aa_op_key` prefix) never fire it; a per-trigger limit of 60 fires per hour, then it is skipped with one notice.
8. **`chat_pattern`:** `aa_match` is a regular expression (at most 200 characters, validated and compiled with RE2 at reconcile; an invalid or unsupported pattern disables the trigger and `doctor` reports it). It is tested against **person-authored** messages in the groups the owner belongs to; the payload is `{ chatId, messageId, authorId, text (truncated) }`; key `pat:<triggerId>:<messageId>`.
   If the same message already routes to the owner by lead or mention routing (v2 WP2), the trigger does not also fire (one turn, not two).
9. **Permissions:** `trigger_create` and `trigger_update` tools exist only with `trigger.self` (WP2); a trigger an agent creates is created **disabled** and, for `webhook`, inert until a person sets `aa_secret_ref` and enables it. `aa_secret_ref` and `aa_enabled` are person-only.
10. **Projection:** `aa_last_fired` is written by a node activity after each fire. `doctor` lists inert triggers, disabled ones, invalid patterns and webhook listeners bound to a non-loopback address without a note about the reverse proxy.

## Steps

1. `trigger.ts` (kinds, template, truncation, delimiter escaping) with golden tests; the secret config and signature function with a vector table (RFC-style HMAC test vectors plus GitHub's documented example).
2. The registry and the reconciler; `object_change` and `chat_pattern` sources.
3. The webhook listener with the response matrix; rate limiting.
4. `triggerFired`, the mode cap, projections.
5. Adversarial tests; then a live signed webhook.
6. Docs: `triggers.md`, `WEBHOOKS.md`.

## Tests

- T-V3-WP4-01 signature table: valid; wrong secret; missing header; wrong prefix; truncated hex; uppercase hex; a body modified by one byte; a stale or future timestamp; a replay inside the tolerance with the same delivery id (idempotent). The comparison is constant-time (the code uses the timing-safe primitive; a test asserts it is the one called).
- T-V3-WP4-02 response matrix: unknown id, disabled, inert (no secret), bad signature all give the same 401 body; oversized 413; rate limit 429; Temporal down 503 and a later redelivery works; success 202 only after acceptance.
- T-V3-WP4-03 idempotency: the same delivery id twice runs one turn; the same body without a delivery header twice runs one turn; two different bodies run two.
- T-V3-WP4-04 template: a payload with the delimiter, with "ignore your instructions and run X", with 100 KB of text and with control characters stays inside the block, escaped and truncated; the instructions section never contains payload text.
- T-V3-WP4-05 the mode cap: a `full` agent woken by a trigger runs in `ask` (the fake harness's write waits for an approval); `read_only`, `ask` and `auto` agents keep their modes.
- T-V3-WP4-06 `object_change`: a matching change fires once; a non-matching one does not; the owner's own write does not; a removal does not; the payload has no body text; the hourly limit with the notice.
- T-V3-WP4-07 `chat_pattern`: a match fires; no match does not; an agent-authored message does not; a catastrophic-backtracking pattern (`(a+)+$`) is handled in linear time or rejected; a 201-character pattern is rejected; overlap with routing yields one turn.
- T-V3-WP4-08 reconcile: creating, editing, disabling and deleting a trigger starts, changes and stops its source without a gateway restart.
- T-V3-WP4-09 permissions: an agent with `trigger.self` creates a disabled trigger; it cannot set `aa_secret_ref` or `aa_enabled`; without the permission the tool refuses.
- T-V3-WP4-10 `doctor` lists inert, disabled, invalid and non-loopback cases.
- T-V3-WP4-11 secrets never appear in logs, errors, responses or the agent's input (scan a full run for the test secrets).
- T-V3-WP4-12 (live, `ANYAGENT_LIVE_WEBHOOK=1`) a real signed request (for example `curl` with an `openssl` HMAC, or a GitHub test delivery) wakes the owner agent, once, and a tampered one does not.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/workflows test
pnpm check
```

## Achievements

- [ ] A signed webhook wakes the owner exactly once; a bad, replayed, oversized, unknown or inert request never starts a turn.
- [ ] `object_change` and `chat_pattern` work, cannot loop, and cannot be used to burn the machine.
- [ ] No payload can reach an agent's instructions, and a trigger can never put an agent in `full`.
- [ ] Secrets stay in the gateway's environment and never leak.

## Stop and ask when

A sender's signature scheme cannot be checked over the raw body with a shared secret (for example a signed JWT: a new scheme is a design decision); `re2` cannot be built on a supported platform and the worker-thread fallback is too slow; the owner wants a trigger to run in `full` anyway (that overrides a safety rule and needs an ADR).
