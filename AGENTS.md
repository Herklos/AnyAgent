# Working in this repository (for agents and people)

anyagent runs a team of AI agents from Anytype: Anytype is the source of truth and the message bus, one shared Temporal
runs one durable workflow per agent, and nodes (your machines) run the harnesses. The repository is at the
**specification** stage: documents and spikes, no product code yet.

## Read first

- [docs/VISION.md](docs/VISION.md): the principles every change must respect.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the components and how a message becomes work.
- [docs/adr/](docs/adr/): the decisions. Change an ADR in the same commit as the behaviour it decides.
- [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md): do not settle one of these silently; ask the owner.

## Layout

`docs/` (vision, architecture, ADRs, specs, research), `spikes/` (throwaway proofs, each with a README stating what it
proved and what it did not). Planned once code starts: `packages/` (TypeScript, pnpm workspace) and `apps/node`.

## Rules

1. **Small commits, Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), signed off (`git commit -s`).
2. **Anytype is the source of truth.** Nothing about the org (agents, groups, schedules, triggers, tasks, approvals) is
   stored only in Temporal or on a node. Temporal holds execution state that can be rebuilt from Anytype ([ADR 0002](docs/adr/0002-anytype-is-the-source-of-truth.md)).
3. **No secrets in Anytype.** API keys, tokens and webhook secrets live on the node that uses them. Anytype holds
   references and capabilities only.
4. **Workflow code is deterministic**: no `Date.now()`, `Math.random()`, I/O or Node imports in workflow code.
5. **Every fact about Anytype cites its source** (file and commit in `anyproto/anytype-heart` or `anytype-cli`, or a
   test against a live instance). Unverified claims are labelled unverified.
6. **Generic by default** (inherited from Michel's ADR 0025): no agent names, models, hosts or space ids in logic; they
   come from Anytype objects or node config. A new harness is a registry entry, a new trigger is a kind. Every ADR has
   an **Extension points** section and says what it deliberately does not generalise.
7. **Spikes prove one thing each** and say honestly what they did not prove (a mock is not a live server).
8. **Never push to `main`.** Work lands on a branch and the owner merges.
