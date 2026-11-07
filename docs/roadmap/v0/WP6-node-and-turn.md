# WP6: node activities and the `AnyBot` workflow

**Goal.** A message that reaches the workflow becomes a turn on the right harness, with a reply posted in the agent's chat, a clear notice when something fails, and the harness session kept across turns and
across workflow rotations. After this package, everything between "the gateway accepted a message" and "the reply is in the chat" exists.

**Depends on:** WP2 (spec, author policy), WP3 (core), WP4 (harness, permissions), WP5 (gateway and the init data). **Unblocks:** WP7, WP8.

## Scope

In: the `AnyBot` workflow (on `AgentCore`), four activities (`resolveConfig`, `markReceived`, `runTurn`, `deliver`), the node-side store (sessions, delivered operations), worker wiring.
Out: approvals, schedules, streaming replies (Q13: one final message), an editable "working…" message, more than one node, notices beyond the five listed below.

## Read first

[specs/agent-workflow.md](../../specs/agent-workflow.md) ("A turn", "Activities"), `docs/specs/agent-core.md` (written in WP3), [ADR 0018](../../adr/0018-one-or-more-orgs-per-deployment.md) (queue names), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (person-only fields),
[ADR 0002](../../adr/0002-anytype-is-the-source-of-truth.md). Reference: Michel `apps/node/src/activities.ts` (`harnessTurn`: session handling, heartbeat, cancellation) and `packages/temporal/workflows/src/agent.ts`.

## Files

Create: `packages/workflows/src/{contracts.ts,anybot-workflow.ts,workflows.ts}`, `packages/workflows/test/anybot-workflow.test.ts`, `packages/node/src/{store.ts,activities/{resolve-config,mark-received,run-turn,deliver}.ts,worker.ts,index.ts}`,
`packages/node/test/*.test.ts`.
Change: `docs/specs/agent-workflow.md` (the v0 behaviour as built: names, notices, timeouts), `docs/specs/schema.md` if a field is added below.
Dependencies: none new beyond WP0 to WP5.

## Contracts (`contracts.ts`; types and constants only, imported by both sides, no Node imports)

```ts
export const AGENT_WORKFLOW_TYPE = "AnyBot";  export const WORKFLOW_TASK_QUEUE = "anybot";
export const workflowIdFor = (spaceId: string, agentId: string) => `agent:${spaceId}:${agentId}`;
export const nodeQueueFor  = (spaceId: string, handle: string) => `node:${spaceId}:${handle}`;
export interface AgentInit { orgId: string; spaceId: string; agentId: string; nodeQueue: string }
export interface NodeActivities {
  resolveConfig(i: { orgId: string; spaceId: string; agentId: string }): Promise<ResolvedConfig>;
  markReceived(i: { orgId: string; spaceId: string; chatId: string; messageId: string }): Promise<void>;
  runTurn(i: TurnRequest): Promise<TurnResult>;
  deliver(i: DeliverRequest): Promise<{ messageId: string }>;
}
export type ResolvedConfig =
  | { ok: true; spec: AgentSpecWire; ownerIds: string[] }
  | { ok: false; reason: "invalid" | "unacceptable-editor" | "workdir-outside-roots"; detail: string };
```

(`AgentSpecWire` is the plain-data form of WP2's `AgentSpec`; `TurnRequest` carries the spec, the text, the workflow id and `orgId`; `TurnResult` is `{ text, stopReason, sessionId, usage? }`;
`DeliverRequest` is `{ orgId, spaceId, chatId, kind: "reply" | "notice", text, replyTo?, key }`.)

## Behaviour: a turn

1. `resolveConfig` reads the agent fresh through the org's backend (object, body, owners) and returns data. It refuses with `invalid` (the spec does not parse), `unacceptable-editor` (WP2 step 7, only if the backend exposes the modifier),
   or `workdir-outside-roots`. **New field:** the agent's working directory is `aa_workdir` (text, an absolute path on the node; defined in WP2). The node's `node.workdirRoots` (default: the user's home) bounds it;
   empty `aa_workdir` means a private empty directory under the state dir.
2. If not `ok`: post **one** notice (`I cannot run right now: <detail>. See anybot doctor.`) and end the turn.
3. If `lifecycle` is `paused`: end the turn silently (no reply, no reaction).
4. Defence in depth: if the author is not allowed by `isAllowedAuthor` (WP2), end the turn silently (the gateway already filtered; this guards a bug or a hand-sent update).
5. `markReceived`: 👀 on the message, best effort (a failure is logged and ignored).
6. `runTurn` (start-to-close `tuning.turnTimeoutMin` default 60 minutes, heartbeat timeout 60 s, **`maximumAttempts: 1`**, so a turn that started is never rerun by retry): starts or resumes the harness session, sends the text, answers each permission
   request with `decidePermission(spec.approvalMode, request)` (WP4), heartbeats every 10 s, and returns the reply text. On cancellation it calls `session.cancel()` then `close()`.
7. `deliver` posts the reply in the agent's chat as a reply to the message, then swaps 👀 for ✅. Long replies are split on paragraph boundaries into messages of at most `tuning.maxMessageChars` (default 8000), in order.
8. **Failures** end in exactly one notice, from this table, and the loop moves on:
   - activity timeout or heartbeat timeout, or the process died: `That turn was interrupted before it finished. Send the message again.`
   - the harness is missing or not logged in (`HarnessUnavailable`): `<harness> is not installed or not signed in on this machine. Run anybot doctor.`
   - the harness reported an error (`HarnessError`): `The harness reported an error: <first line, at most 200 characters>.`
   - the reply was empty: `The agent finished without writing a reply.`
   - the post failed after retries: log only (the chat is the channel; do not loop).
9. **Sessions.** The harness session id lives on the node (`store.ts`: table `sessions(workflow_id, harness, model, mode, session_id)`), not in the workflow, so it survives rotation. It is reused only if harness, model and mode are unchanged; otherwise a new session starts.
   If the harness says the session cannot be resumed, start a new one and continue.
10. **Idempotent delivery.** `deliver` records `key` in `ops(key, message_id)` before returning; a retry with the same key returns the earlier message id and posts nothing. (A crash between posting and recording can still duplicate once;
    that window is accepted for v0 and written in the spec.)

## Steps

1. Contracts and the node store (`better-sqlite3`), with tests.
2. Activities one at a time against the reference backend (WP1) and the fake harness (WP4): `deliver`, `markReceived`, `resolveConfig`, then `runTurn`.
3. The workflow: compose `createOwnCore()` with `proxyActivities` (queue from the init data; per-activity timeouts as above; `runTurn` retries `maximumAttempts: 1`, the others a short retry). Failure to notice mapping in one function with a test per row.
4. Worker wiring (`worker.ts`): `startWorkflowWorker({ temporal })` on `anybot` with the bundled workflow code; `startNodeWorker({ config, backends })` on `node:<spaceId>:<handle>` for each org the node serves, checking the org is on the node's list.
5. End-to-end inside the package with Temporal's test environment, the reference backend and the fake harness (no gateway): send updates directly.
6. Update the workflow spec.

## Tests

- T-WP6-01 `resolveConfig`: valid, invalid spec, unacceptable editor (if exposed), workdir outside roots, owners resolved.
- T-WP6-02 `deliver`: reply posted as a reply; 👀 becomes ✅; the same key twice posts once; a 20,000-character reply becomes 3 ordered messages; a notice is a plain message.
- T-WP6-03 `markReceived`: failure does not throw.
- T-WP6-04 `runTurn` (fake harness): returns text; a second turn resumes the session; a changed model starts a new session; the session id is stored on the node; heartbeat is called while the harness is busy.
- T-WP6-05 `runTurn` permission handling: in `read_only` a write request is denied and the harness's reply says so; in `full` it is allowed; a credential read is denied in both.
- T-WP6-06 `runTurn` cancellation kills the child, leaves no orphan, and heartbeat stops.
- T-WP6-07 (Temporal, mocked activities) happy path: one message, one reply, 👀 then ✅.
- T-WP6-08 (Temporal) paused agent: no activity beyond `resolveConfig`, no reply, no reaction.
- T-WP6-09 (Temporal) invalid config: exactly one notice. Not-allowed author: silence.
- T-WP6-10 (Temporal) each failure in the table produces its notice and the next message still works.
- T-WP6-11 (Temporal) three messages queue and are answered in order.
- T-WP6-12 (Temporal) a rotation (close, then a new run) keeps the session id (node store) so the next turn resumes it.
- T-WP6-13 (Temporal) replay of a recorded history succeeds.
- T-WP6-14 (Temporal, fake harness, reference backend) end to end without the gateway: message in, reply out, `read_only` refusal visible in the reply.

## Checks

```bash
pnpm --filter @anybot/workflows test && pnpm --filter @anybot/node test
pnpm --filter @anybot/workflows exec tsc --noEmit
grep -rn "Date\.\|Math\.random\|from \"node:" packages/workflows/src   # expect: no output (workflow determinism)
pnpm check
```

## Achievements

- [ ] A scripted message produces a reply and the right reactions through workflow, activities, fake harness and reference backend.
- [ ] Every failure row produces exactly one notice and never stops the loop.
- [ ] The session survives a rotation and a worker restart.
- [ ] `read_only` refusals reach the person as part of the reply.
- [ ] `docs/specs/agent-workflow.md` describes what was built.

## Stop and ask when

A harness cannot resume sessions (then "keep the session" has to change); notices would need information the spec does not carry; the reply size limit of the backend is below 8000 characters (lower the default and record the number).
