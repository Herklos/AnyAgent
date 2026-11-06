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
          │ signals                  └──── activities ──────────────┤
          ▼                                                         │
   ┌──────────────── one shared Temporal: one workflow per agent ───┴──────────┐
   └───────────────────────────────────────────────────────────────────────────┘
```

- **Anytype is the source of truth and the bus.** Who the agents are, what they must do, when, and what they said all
  live in Anytype. Edit an agent object and the next turn uses it. There is no apply step.
- **Temporal is the engine, not the database.** Each agent is exactly one long-lived workflow. Chat messages, object
  changes, cron schedules and webhooks become signals to it. Its state can be rebuilt from Anytype.
- **One way in.** An event gateway reads the Anytype streams (with a read-only key) and receives webhooks, then forwards
  each event to the workflow of the agent it concerns.
- **Any harness, any model.** Claude Code, Codex, OpenCode, any ACP agent, or an OpenAI-compatible API (including local
  models) behind one adapter interface, reused from [Michel](https://github.com/Herklos/Michel).
- **Talk in chat, work in objects.** Conversation happens in Anytype chats. Durable work (tasks, approvals, schedules)
  is typed objects linked from the chat.
- **You stay in charge.** Risky actions wait for an approval object that you decide with a ✅ or ❌ from your own
  Anytype identity.

## Documents

| Document | What it holds |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Philosophy, principles, what anyagent is not |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, lifecycles, failure modes |
| [docs/specs/schema.md](docs/specs/schema.md) | The Anytype schema anyagent reads and writes (v0 draft) |
| [docs/specs/agent-workflow.md](docs/specs/agent-workflow.md) | The one workflow per agent: signals, updates, timers, activities |
| [docs/adr/](docs/adr/) | Decisions and why |
| [docs/research/anytype-api.md](docs/research/anytype-api.md) | Verified facts about the Anytype API, with sources |
| [docs/research/michel-reuse.md](docs/research/michel-reuse.md) | What anyagent reuses from Michel |
| [docs/SPIKES.md](docs/SPIKES.md) | Spikes: done, planned, and what each must prove |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | What is still undecided |
| [docs/ROADMAP.md](docs/ROADMAP.md) | v0 slice and what comes after |

## Inspiration

[Michel](https://github.com/Herklos/Michel) (durable agents on Temporal, harness adapters, verified work),
[Herklos/skills](https://github.com/Herklos/skills) (`anytype-agents`, `hermes-profiles`, `osaurus-agents`: an org of
agents run from Anytype by hand), Hermes Agent Bot Mode, Osaurus, Noodle.

## Licence

[Apache-2.0](LICENSE). anyagent talks to Anytype over its HTTP API and does not bundle
[anytype-heart](https://github.com/anyproto/anytype-heart), which has its own licence
([ADR 0004](docs/adr/0004-typescript-over-the-http-api.md)).
