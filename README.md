# anyagent

**A team of AI agents that lives in Anytype.** Agents are defined, organised, scheduled and talked to through
[Anytype](https://anytype.io) objects and chats. Each agent runs on a machine of yours, with the harness or model API of
your choice, and coordinates with the others through the same Anytype spaces you already use.

> **Status: specification.** Nothing runs yet beyond [spike 001](spikes/001-ts-sse/). This repository is being specified,
> designed and spiked in the open. Read the [vision](docs/VISION.md), the [architecture](docs/ARCHITECTURE.md) and the
> [decisions](docs/adr/).

## The idea in one picture

```
                you (Anytype desktop / mobile): chat, objects, ✅/❌
                                    │
   ┌──────────────── Anytype space (p2p, end-to-end encrypted) ────────────────┐
   │  Agents · Groups (chats) · Tasks · Schedules · Triggers · Approvals · …   │
   └──────┬──────────────────────────▲──────────────────────────────▲──────────┘
          │ SSE (read-only)          │ HTTP writes                  │
   ┌──────▼────────┐          ┌──────┴──────┐                ┌──────┴──────┐
   │ event gateway │◄─webhooks│  node: Mac  │                │  node: Pi   │   each node: anytype serve
   │ route+dedupe  │          │ claude-code │      …         │ local model │   + Temporal worker
   └──────┬────────┘          └──────▲──────┘                └──────▲──────┘   + harness adapters
          │ updates                  └──── activities ──────────────┤
          ▼                                                         │
   ┌──────────────── one shared Temporal: one workflow per agent ───┴──────────┐
   └───────────────────────────────────────────────────────────────────────────┘
```

- **Anytype is the source of truth and the bus.** Who the agents are, what they must do, when, and what they said all
  live in Anytype. Edit an agent object and the next turn uses it. There is no apply step.
- **Temporal is the engine, not the database.** Each agent is exactly one long-lived workflow, built on
  [temporal-agent-harness](https://github.com/temporal-community/temporal-agent-harness) from npm. Chat messages, object
  changes, cron schedules and webhooks are delivered to it. Its state can be rebuilt from Anytype.
- **One way in.** An event gateway reads the Anytype streams (with a read-only key) and receives webhooks, then forwards
  each event to the workflow of the agent it concerns.
- **Any harness, any model.** Claude Code, Codex, OpenCode, any ACP agent, or any OpenAI-compatible API, local
  (llama.cpp) or cloud, behind one adapter interface reused from [Michel](https://github.com/Herklos/Michel). Computer
  and desktop use through [cua](https://github.com/trycua/cua) is planned.
- **Your infrastructure, your choice.** Temporal self-hosted or Cloud, Anytype's sync network or your own any-sync,
  local or cloud models: configuration, not code. Fully local works.
- **Talk in chat, work in objects.** Conversation happens in Anytype chats. Durable work (tasks, approvals, schedules)
  is typed objects linked from the chat.
- **You stay in charge.** Risky actions wait for an approval object that you decide with a ✅ or ❌ from your own
  Anytype identity. In `auto` mode a decision model (local or cloud) may answer routine ones first, and never fails
  open. Agents change the org (agents, groups, schedules) only as far as their permissions allow.

## Documents

| Document | What it holds |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Philosophy, principles, what anyagent is not |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, lifecycles, failure modes |
| [docs/specs/schema.md](docs/specs/schema.md) | The Anytype schema anyagent reads and writes (v0 draft) |
| [docs/specs/agent-workflow.md](docs/specs/agent-workflow.md) | The one workflow per agent: handlers, updates, approvals, rotation, activities |
| [docs/adr/](docs/adr/) | Decisions and why |
| [docs/research/anytype-api.md](docs/research/anytype-api.md) | Verified facts about the Anytype API, with sources |
| [docs/research/michel-reuse.md](docs/research/michel-reuse.md) | What anyagent reuses from Michel |
| [docs/research/temporal-agent-harness.md](docs/research/temporal-agent-harness.md) | The npm harness: install check, API, limits |
| [docs/SPIKES.md](docs/SPIKES.md) | Spikes: done, planned, and what each must prove |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | What is still undecided |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Releases v0 to v3, most important first, and what comes after |
| [docs/roadmap/v0/](docs/roadmap/v0/README.md) | The v0 build plan: nine work packages for an implementing agent, with tests and checks |

## Inspiration

[Michel](https://github.com/Herklos/Michel) (durable agents on Temporal, harness adapters, verified work),
[Herklos/skills](https://github.com/Herklos/skills) (`anytype-agents`, `hermes-profiles`, `osaurus-agents`: an org of
agents run from Anytype by hand), Hermes Agent Bot Mode, Osaurus, Noodle.

## Licence

[Apache-2.0](LICENSE). anyagent talks to Anytype over its HTTP API and does not bundle
[anytype-heart](https://github.com/anyproto/anytype-heart), which has its own licence
([ADR 0004](docs/adr/0004-typescript-over-the-http-api.md)).
