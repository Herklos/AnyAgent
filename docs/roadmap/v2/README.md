# v2 work pack: a team

Build plan for release **v2** of [../../ROADMAP.md](../../ROADMAP.md). Same format and rules as the [v0 pack](../v0/README.md) (read its README first: rules 1 to 10, conventions and glossary apply unchanged) and the [v1 pack](../v1/README.md).
**v1 must be released** (its report exists and its acceptance passed) before v2 starts.

## The product slice

More than one agent, working together in shared group chats, on more than one machine. A person writes in a group without a mention and the group's lead answers; agents hand work to each other through tasks and mentions; the work is visible as `aa_task` objects on a board; the gateway and the nodes are separate processes on
separate machines; agents can share a bot account, use a pool, or have one each; and an agent can create tasks and its own schedules, but nothing more.

**Out of scope for v2:** the full permission table and agents creating or editing agents and groups (v3), the decision model and `auto` (v3), triggers and webhooks (v3), claims (v3), `any` as a backend, computer use, memory and skills, object discussions waking agents (Q5, stays "no"), a high-availability gateway (Q12).

## The story it must tell (the acceptance in one paragraph)

A person writes in the team group with no mention; the **Primary** (the group's lead) answers and creates an `aa_task` linked to the message, lead = the **chief**; the chief assigns a **specialist** (hierarchy) and @mentions them; the specialist, on another machine, works, asks one approval (✅ by the person from their own account),
delivers an `aa_result`, moves the task to `review`; the chief moves it to `done`; the answer appears in the chat. Repeated with each of the three account setups.

## Definition of done

The roadmap's v2 "Done when" and [WP8](WP8-acceptance-and-release.md) pass, every work package's achievements are ticked in [STATUS.md](STATUS.md) with evidence, and a `REPORT.md` is written.

## Work packages

| WP | Title | Depends on | Size (est.) |
| --- | --- | --- | --- |
| [WP1](WP1-schema-and-migration.md) | Schema delta and `anybot migrate` | v1 released | 4–5 days |
| [WP2](WP2-groups-mentions-routing.md) | Groups, mentions, routing, the loop guard | WP1, WP5 | 1–1.5 weeks |
| [WP3](WP3-hierarchy-and-prompts.md) | Hierarchy, shared prompts and rules, session scope | WP1 | 4–5 days |
| [WP4](WP4-tasks-and-org-tools.md) | Tasks, the state machine, and the `anybot` tools for harnesses | WP1, WP2 | 1.5 weeks |
| [WP5](WP5-accounts-and-identity.md) | Accounts and identity resolution (spike 011 in full) | WP1 | 1 week |
| [WP6](WP6-gateway-and-nodes-apart.md) | Gateway and nodes as separate processes; `aa_node` (spikes 008, 010, 003) | WP1, WP5 | 1.5 weeks |
| [WP7](WP7-defaults-for-own-work.md) | The defaults for agents' own work: `task.create`, `schedule.self` | WP4, WP5 | 4–5 days |
| [WP8](WP8-acceptance-and-release.md) | End-to-end acceptance and release | all | 1 week |

```
v1 ─ WP1 ─┬─ WP5 ─┬─ WP2 ─ WP4 ─┐
          │       ├─ WP6 ───────┤
          ├─ WP3 ───────────────┼─ WP7 ─ WP8
          └─────────────────────┘
```

## What is different from v1

- **Schema versions `0.3.0` (WP1) and `0.3.1` (WP7, the permission fields)**, additive ([ADR 0009](../../adr/0009-new-minimal-versioned-schema.md)); `anybot migrate` is real (WP1) and `init` calls it.
- **A node is not the gateway.** From WP6 the two are separate commands; `anybot run` still starts both for a one-machine setup.
- **`resolveConfig` moves to a control queue** (WP6): it only reads, and it must run before the agent's node is known, so it runs on a queue served by the gateway process (and by any node), never on the agent's node queue.
- **The org tools:** the harness reaches Anytype only through an MCP server the node provides (`anybot` tools, WP4). The read-write key never reaches the harness ([ADR 0013](../../adr/0013-agent-permissions-over-the-org.md) decision 3).
- **Open questions that touch v2:** [Q5](../../OPEN-QUESTIONS.md) (object discussions do not wake agents), [Q6](../../OPEN-QUESTIONS.md) (a space is the privacy boundary: every member can read every chat; the guide says so), [Q12](../../OPEN-QUESTIONS.md) (one gateway).
- **Live-test variables:** `ANYBOT_LIVE_TWO_MACHINES=1` (a second machine reachable for the node; `anybot node` run there).
