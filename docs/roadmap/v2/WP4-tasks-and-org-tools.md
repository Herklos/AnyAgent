# v2 WP4: tasks, the state machine, and the `anybot` tools for harnesses

**Goal.** Work is an object. An agent can create a task, hand it on, work it, deliver a result and see it reviewed, each step visible in Anytype and in the group chat, with exactly one writer per field. Because the harnesses are external programs, they reach Anytype only through a small set of tools that the node provides and checks;
the read-write key never reaches a harness.

**Depends on:** WP1, WP2. **Unblocks:** WP7, WP8.

## Scope

In: the task rules (pure), the task write activity with idempotency, waking the concerned agents on task changes, task notices in chat, the `anybot` tools (`task_create`, `task_update`, `task_get`, `task_list`, `message_post`), the node-side bridge to the harness, the tools for the in-process (OpenAI) harness.
Out: claims (v3), agents creating or editing agents, groups, prompts or triggers (v3), schedules by agents (WP7), file attachments, subtasks, due-date reminders.

## Read first

[ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md), [ADR 0007](../../adr/0007-chat-for-talk-objects-for-work.md), [ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) (decision 3: the key stays in the node), [specs/schema.md](../../specs/schema.md) (`aa_task`), [specs/agent-workflow.md](../../specs/agent-workflow.md) (`objectChanged`), WP2 (`ChatInput`, group routing), [ADR 0020](../../adr/0020-harness-adapter-kinds.md) (capabilities),
and Michel `packages/mcp/michel` as a reference for tools given to agents (read, do not copy blindly; Apache-2.0 with provenance if copied).

## Files

Create: `packages/core/src/task-rules.ts`, `packages/mcp/src/{bridge.ts,tools.ts,server.ts,index.ts}` (new package `@anybot/mcp`), `packages/node/src/{tool-api.ts,activities/task-write.ts}`, `packages/gateway/src/tasks.ts`, `apps/cli/src/mcp-bridge.ts`, tests in each, `docs/specs/org-tools.md`.
Change: `packages/workflows/src/{contracts.ts,anybot-workflow.ts}` (`objectChanged` handler), `packages/harness/src/registry.ts` (`mcpTools` capability, `mcpServers` in `SessionInit`), `packages/harness/src/openai/tools.ts` (the same tools natively), `packages/gateway/src/supervisor.ts`.
Dependency: `@modelcontextprotocol/sdk` pinned exactly (verify the version on npm; Michel used 1.32.2).

## The task rules (pure)

- **Status transitions and writers:** `backlog → ready` (lead); `ready → in_progress` (assignee); `in_progress → review` (assignee); `review → done` (lead or the reviewer); any `→ blocked` (assignee); `blocked → in_progress` (assignee) or `blocked → ready` (lead); any `→ cancelled` (lead). Anything else is refused with the reason.
- **Field writers:** `aa_assignee`, `aa_reviewer`, `aa_criterion`, `aa_due`, `ready`, `done`, `cancelled`: lead only. `aa_result`: assignee only. `aa_group`, `aa_requested_by`, `aa_origin_message`: creator only at creation. The reviewer must differ from the assignee; the assignee and reviewer must be members of the task's group; an agent never assigns itself ([ADR 0006](../../adr/0006-coordination-hierarchy-with-opt-in-claims.md) decision 1).
- **Who is the lead:** the task's `aa_lead`; a person may also act as lead from Anytype (people are not restricted by these rules, only agents are).
- `taskRules.check(task, actor, change)` returns `{ ok: true } | { ok: false, reason }`.

## Behaviour

1. **Writes** go through the node activity `taskWrite` (runs on the acting agent's node, as its account): reads the task, applies `check`, writes with `expect` on the status version, and sets `aa_op_key = <agentId>:<opKey>` where `opKey` is the turn key plus the tool call id; a repeated call with the same `opKey` returns the earlier result without writing.
2. **Waking** (gateway `tasks.ts`): watch `aa_task` objects; for each change compute the concerned agents and send them `objectChanged` `{ key, type: "aa_task", objectId, change, fields }` with `key = task:<objectId>:<versionToken>:<agentId>`:
   created → the lead; `ready` with an assignee → the assignee; `review` → the reviewer (else the lead); `blocked` → the lead; `done` or `cancelled` → the requester if it is an agent. **Never wake an agent for a change whose `aa_op_key` starts with its own id** (it made it). A change by a person wakes the concerned agents as above.
3. **`objectChanged` turn:** the prompt is built from the task fields (title, status transition, criterion, result, your role on this task) as a delimited data block; the reply, if any, goes to the task's group chat as a reply to the origin message when it exists.
4. **Task notices** (posted by the acting node, one line, only for these transitions): created, assigned, `review`, `done`, `blocked`, `cancelled`: `📋 <title> → <status> (@handle)` with a link to the object. They are agent messages and are never routed ([WP2](WP2-groups-mentions-routing.md)).
5. **Origin:** a task created in answer to a message stores `aa_origin_message` as `chatId/messageId`; the group's chat message that started it gets a reply with the task link.
6. **The tools** (`docs/specs/org-tools.md` is written in this package): `task_create { title, body?, assignee?, reviewer?, criterion?, due?, group? }` (group defaults to the one the turn came from), `task_update { taskId, status?, result?, assignee?, reviewer?, criterion?, due? }`, `task_get { taskId }`, `task_list { status?, assignee?, group? }` (max 50),
   `message_post { groupId, text, replyTo? }` (only to groups the agent is a member of; rate limited to 6 per turn). Each returns plain text and structured content, with errors as tool errors carrying the rule's reason.
7. **The bridge, so the key stays on the node:** `anybot mcp-bridge` is a tiny stdio MCP server (no secrets, no Anytype client) that the harness starts from `mcpServers`; it forwards each call over a **Unix domain socket** in the agent's home directory to the node's `tool-api`, authenticated by a random per-turn token passed in the bridge's environment.
   The node validates the token (agent id, org, current task or group, expiry at turn end), checks permissions (WP7 for creation, here for task rules), calls `taskWrite` or the backend, and answers. Tokens die with the turn; a replayed token fails. Unix only.
8. **Harness support:** a descriptor declares `mcpTools: true` if the harness accepts MCP servers (Claude Code, Codex and Grok through their ACP or app-server session setup; verify live). The in-process OpenAI harness gets the same tools natively with the same checks. **Headless Vibe has no org tools**; `doctor` says so and an agent on it cannot create tasks.
9. **Harness environment:** the node's read-write key is never in the environment of a harness or of the bridge (test below).

## Steps

1. `task-rules.ts` with the full transition and writer tables.
2. `taskWrite` against the reference backend with op-key idempotency and the `expect` check.
3. Gateway task watcher and the concerned-agents function (pure), with the self-change skip.
4. `objectChanged` handler and prompt block; task notices.
5. `tool-api` and the bridge over a Unix socket; the token scheme; the tools; then the native OpenAI tools.
6. Live pass per harness with `mcpTools` (spike): each harness lists and calls the tools; record the exact `mcpServers` shape each accepts in `docs/specs/org-tools.md`.
7. `docs/specs/org-tools.md` and `agent-workflow.md`.

## Tests

- T-V2-WP4-01 the transition table: every allowed and every refused transition, with the actor roles; reviewer equals assignee refused; assignee not a group member refused; an agent assigning itself refused.
- T-V2-WP4-02 field writers: each field by each role.
- T-V2-WP4-03 `taskWrite` idempotency: the same `opKey` twice writes once; a stale status (changed since read) is refused with a clear reason.
- T-V2-WP4-04 concerned agents: each change type; the self-change skip; a change by a person; an unattributed change (no op key) wakes the concerned agents.
- T-V2-WP4-05 (Temporal) a created task wakes the lead once even if the gateway restarts mid-delivery; keys are per version and per agent.
- T-V2-WP4-06 notices: one line per listed transition, with the link; none for other changes; never routed.
- T-V2-WP4-07 the bridge: a harness calls each tool and gets the result; a call with no or a wrong token fails; a token from a finished turn fails; a token for another agent's turn fails.
- T-V2-WP4-08 the harness and bridge environments contain no read-write key (spawn a probe that dumps its environment).
- T-V2-WP4-09 `message_post` is refused for a group the agent is not in and is rate limited.
- T-V2-WP4-10 the OpenAI harness's native tools apply the same checks as the bridge (run both against one table of cases).
- T-V2-WP4-11 (Temporal, reference backend, fake harness scripted to call tools) the full story below the lead: create, assign, `ready`, `in_progress`, `review`, `done`, with the right wakes and notices and no duplicate writes.
- T-V2-WP4-12 (live, opt-in per harness) a real harness lists the tools and creates a task on a throwaway space.

## Checks

```bash
pnpm --filter @anybot/core test && pnpm --filter @anybot/mcp test && pnpm --filter @anybot/node test && pnpm --filter @anybot/gateway test && pnpm --filter @anybot/workflows test
pnpm check
```

## Achievements

- [ ] A task moves through its whole life by agents and people, each field written only by its writer.
- [ ] Every transition is visible as an object change and a one-line notice, with the origin message linked.
- [ ] Harnesses use the tools through a bridge; the read-write key never leaves the node, proven by a test.
- [ ] No change wakes the agent that made it, and no change wakes anyone twice.

## Stop and ask when

A shipped harness cannot take MCP servers (the org tools then need another route, which is a design decision); the backend cannot make the status write conditional on the previous version (then two simultaneous writers could both succeed: record it and propose serialising through the lead); the Unix-socket bridge cannot work in the target environment.
