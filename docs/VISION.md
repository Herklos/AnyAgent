# Vision and principles

## What anyagent is

anyagent turns an Anytype space into the operating system of a team of AI agents. You define agents, groups, schedules,
triggers and work as Anytype objects; you talk to the team in Anytype chats; the agents run on your own machines with the
harnesses and model providers you already pay for, and they coordinate through the same space.

It grew out of two things that already exist:

- **[Herklos/skills](https://github.com/Herklos/skills)**: an organisation of about fifty agents (Primary, HQ chiefs,
  specialists) whose truth lives in Anytype (`anytype-agents`), applied by hand into Hermes profiles (`hermes-profiles`)
  and Osaurus (`osaurus-agents`). Its own README states the gap: "Editing Anytype does not push configs; apply with
  `hermes-profiles` after an accepted suggestion." anyagent removes the apply step: the runtime reads Anytype.
- **[Michel](https://github.com/Herklos/Michel)**: durable agents on Temporal with harness adapters (Claude Code over ACP,
  Codex app-server, an OpenAI-compatible tool loop), approvals and verified work. anyagent keeps the engine and the
  adapters and replaces Michel's own hub, storage, chat and console with Anytype.

## Principles

1. **Anytype is the source of truth and the bus.** (Behind a backend port, [ADR 0017](adr/0017-anytype-backend-behind-a-port.md):
   Anytype now, its successor `any` next, other backends only far later and weaker.) Anything a person or another agent needs to see (who an agent is, its
   instructions, its schedules, a task, an approval, a reply) is an Anytype object or chat message. If Temporal and every
   node were wiped, the team could be rebuilt from the space.
2. **Temporal is the engine, not the database.** It gives each agent one durable workflow that survives crashes and
   restarts, timers that fire once, and serialised decisions. It holds execution state only.
3. **One agent, one workflow.** Each agent is exactly one long-lived workflow. Everything that should wake it (a chat
   message, a task change, a cron fire, a webhook, another agent's request) is delivered to that workflow.
   There is no other place an agent's behaviour hides.
4. **Talk in chat, work in objects.** Chat is for conversation, @mentions and notices: readable by people. Work that must
   survive and be queried (a task, a handoff, an approval, a result) is a typed object, linked from the message that
   started it.
5. **Live configuration.** An edited agent, prompt or schedule object applies at the next turn boundary, never in the
   middle of a turn. No copy of the configuration is pushed into another tool.
6. **Any harness, any model.** CLI agents (Claude Code, Codex, OpenCode, Gemini, Copilot, any ACP agent) and model APIs
   (OpenAI-compatible, local llama.cpp/Ollama/vLLM/LM Studio) sit behind one adapter interface. A new harness is a
   registry entry, not a branch.
7. **Your machines, your accounts, your infrastructure.** Agents run on nodes you own (laptop, VPS, Raspberry Pi),
   signed in with your own subscriptions or keys, on local or cloud models. Temporal runs self-hosted or on Temporal
   Cloud, and Anytype syncs on its network or your own any-sync: configuration, not code. Secrets never leave the node
   that uses them; Anytype holds references and capabilities.
8. **The human decides.** Risky actions pause on an approval object. You decide with a reaction or an edit from your own
   Anytype identity; Anytype signs every change with its author's key, so a decision cannot be forged by chat text. A
   decision model may answer routine requests first when you allow it, but it escalates whenever it is unsure and
   never fails open. Agents change the org only within the permissions people gave them, and never their own rights.
9. **Hierarchy by default, autonomy by choice.** Work flows from the human to a coordinator to leads to specialists, as in
   the existing org. A group can opt into letting agents claim work; claims are serialised so two agents never take the
   same task.
10. **Readable by people.** Every agent action leaves a trace a person can read in Anytype: a message, a task status, a
    result, an approval. Execution internals (tool inputs, thinking) stay out of chat.
11. **Generic by default.** Agent handles, models, hosts and spaces come from objects and config, never from code.

## What anyagent is not

- **Not a replacement for Anytype.** It uses Anytype's public API as a client; it does not fork or embed anytype-heart.
- **Not fully peer-to-peer (yet).** Anytype is; the execution engine is one shared Temporal (self-hosted or Temporal
  Cloud). This is a deliberate trade for durable execution ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)).
  If Temporal is down, agents stop; nothing in Anytype is lost.
- **Not a chat connector for Slack, Telegram or Discord.** Anytype is the only chat surface in v0.
- **Not a sandbox.** Like Michel v0, a node runs harnesses on the machine it is on. Use a machine you can afford to let
  agents work on, or a container.
- **Not a migration of the Hermes fleet.** It starts with a new minimal schema ([ADR 0009](adr/0009-new-minimal-versioned-schema.md));
  moving the existing org over is a later, explicit step.
