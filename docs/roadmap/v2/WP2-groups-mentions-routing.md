# v2 WP2: groups, mentions, routing, and the loop guard

**Goal.** A group is an Anytype chat with agents and people in it. A person's message reaches the right agent (the lead when unaddressed, the named agent when mentioned, everyone or no one by the group's setting), agents can address each other without ever looping, and each agent's reply
lands in the group.

**Depends on:** WP1 (schema), WP5 (who wrote a message). **Unblocks:** WP4.

## Scope

In: group discovery and chat watchers, mention detection, the routing table, delivery of group messages, the loop guard (`aa_max_hops`) rebuilt from the chat, group-level allowed authors, delivering replies and notices into the group chat, `doctor`.
Out: tasks (WP4), claims (v3), creating or editing groups by agents (v3), object discussions (Q5), threads.

## Read first

[ADR 0011](../../adr/0011-event-gateway.md) (decisions 1, 2 and 6: loop guard in the gateway), [ADR 0007](../../adr/0007-chat-for-talk-objects-for-work.md), [ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) (decision 3: who wrote a message, the handle tag), [specs/schema.md](../../specs/schema.md) (`aa_group`),
[ARCHITECTURE.md](../../ARCHITECTURE.md) sections 3 and 4, WP5's identity function (`resolveAuthor`), and from v1: `packages/gateway/src/{pipeline.ts,supervisor.ts,agents.ts}`, `packages/workflows/src/contracts.ts` (`ChatInput`).

## Files

Create: `packages/core/src/{group-spec.ts,mentions.ts,routing.ts}`, `packages/gateway/src/{groups.ts,loop-guard.ts}`, tests.
Change: `packages/gateway/src/{pipeline.ts,supervisor.ts,agents.ts}`, `packages/workflows/src/contracts.ts` (`ChatInput` gains `groupId`, `authorKind`, `authorHandle`, `mentions`, `hop`), `packages/node/src/activities/{deliver,resolve-config}.ts` (post into a group chat; spec carries the group context),
`docs/specs/agent-workflow.md`, `apps/cli` (`group list`, doctor).

## Behaviour

1. **Discovery:** like agents in v0: list and watch `aa_group` objects; each valid group with a chat id gets a chat watcher; an invalid group (no chat id, a lead who is not a member, members that are not agents) is reported once per change and ignored. An agent can be in several groups; its own direct chat (`aa_chat`) keeps working.
2. **Author kind** (WP5): each message is `person`, `agent` (with the agent's handle), or `unattributed-agent`; the last is **never** routed.
3. **Mentions:** a message mentions an agent if (a) the backend's derived `mentions` contains the participant id of an **exclusive** agent account, or (b) the text contains `@handle` for a member agent's handle (case-insensitive, word boundaries, `^@handle` also matches a handle tag line; not inside a code block or a quote). (b) works for shared accounts, where (a) cannot say which agent. A mention of an agent that is not a member of the group is ignored with no reply.
4. **Routing table** (`routing.ts`, pure), applied per group message from an allowed author:
   | `aa_routing` | no mention | mention(s) |
   | --- | --- | --- |
   | `lead` (default) | the lead | the mentioned member agents (the lead only if mentioned) |
   | `everyone` | all member agents | the mentioned member agents |
   | `none` | nobody | the mentioned member agents |
   An agent never receives its own message. A person's message that mentions several agents goes to each, as separate deliveries with keys `chat:<chatId>:<messageId>:<agentId>`.
5. **Allowed authors:** `aa_allowed_authors` on the group (person-only): empty means every space member who is a person; otherwise only the listed participant ids; an agent account entry is refused ([ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) decision 5). Agent messages are admitted by the loop guard, not by this list.
6. **Agent-to-agent messages** are routed only by mention (or `everyone` routing, with the hop rule). The **loop guard** (`loop-guard.ts`): per chat, count the agent-authored messages since the last person-authored message (rebuilt from the chat history on start, so it needs no workflow state); when the count reaches `aa_max_hops` (default 4) stop routing agent messages in that chat
   and ask a node to post one notice (`Stopped: the agents have exchanged <n> messages without a person. A person's message continues the conversation.`). The next person message resets it. `hop` is passed in `ChatInput` for the log.
7. **Replies:** a turn that came from a group message posts in that group's chat as a reply to the message; on a shared account the first line is the handle tag `**@handle**` ([ADR 0005](../../adr/0005-identity-agents-map-to-accounts.md) decision 4); an exclusive account adds it only if `aa_tag_always`. Notices follow the same rule.
8. **Context for the turn:** the group's `aa_purpose` and its member handles with their one-line role (the first line of each member's body), and the last N messages of the chat (default 20, `tuning.groupContextMessages`, text only, each truncated) are given to the harness as data in a clearly delimited block, not as instructions.
9. **Privacy:** a space is the privacy boundary (Q6): every member can read every chat. `anyagent doctor` prints that sentence once per org; the guide says it.

## Steps

1. `mentions.ts` and `routing.ts` as pure functions with the full tables.
2. `loop-guard.ts` as a pure counter over a message list, then the history rebuild.
3. Group discovery and watchers in the gateway; the delivery path with per-agent keys.
4. Workflow input and the deliver activity for groups; the handle tag.
5. Context block builder with limits and delimiters.
6. End to end with the reference backend and the fake harness: a lead, two members, a person.

## Tests

- T-V2-WP2-01 mentions: participant mention of an exclusive agent; `@handle` text (case, boundaries, in a code block, in a quote, `@handleX`, an email address); a non-member; a shared account's agent via text only.
- T-V2-WP2-02 the routing table over every cell, with one and several mentions, with the sender as a member, and with an agent sender.
- T-V2-WP2-03 allowed authors: empty list, a list, an entry that is an agent account (refused), an unattributed agent message (never routed).
- T-V2-WP2-04 loop guard: counting resets on a person message; a message before the threshold is routed; the threshold message stops routing and produces one notice; a restart rebuilds the same count from history.
- T-V2-WP2-05 a ping-pong between two agents that mention each other stops at `aa_max_hops` with one notice (end to end, fake harness).
- T-V2-WP2-06 delivery keys are per agent: two agents mentioned in one message each run once; a redelivery runs none again.
- T-V2-WP2-07 replies go to the group chat as replies; handle tag present on a shared account, absent on an exclusive one without `aa_tag_always`, present with it.
- T-V2-WP2-08 the context block contains the purpose, members and recent messages, truncated, delimited, and a message containing the delimiter text cannot break out of it.
- T-V2-WP2-09 an invalid group is reported once and does not stop other groups; a group deleted stops its watcher.
- T-V2-WP2-10 an agent in two groups answers each in its own chat with no cross-talk; its direct chat still works.

## Checks

```bash
pnpm --filter @anyagent/core test && pnpm --filter @anyagent/gateway test && pnpm --filter @anyagent/node test && pnpm --filter @anyagent/workflows test
pnpm check
```

## Achievements

- [ ] An unaddressed person message is answered by the lead only; a mention goes to the named agent; `everyone` and `none` behave as the table says.
- [ ] Agents cannot loop: the guard stops any ping-pong at the configured hop count, survives restarts, and tells the people.
- [ ] Unattributed agent messages are never routed; agent accounts can never authorise anyone.
- [ ] Group context reaches the harness as delimited data.

## Stop and ask when

The backend cannot tell which participant a mention names; the chat history cannot be read far enough back to rebuild the loop counter (then the counter must be kept in the gateway's state, and the rotation and restart behaviour needs a decision); messages can arrive out of order in a way that breaks the hop count.
