# ADR 0016: Desktop and computer use through cua (planned, after v0)

- Status: accepted as a plan (owner's request, 2026-11-06: "as Michel plan to be compatible with cua for desktop use and
  computer use"). Not in v0.
- Date: 2026-11-06

## Context

Michel's plan for computer use (Michel `docs/PLAN.md` §15 and line 97; `docs/adr/0012-remote-desktop-and-browser-control.md`)
is a ladder: terminal and files, a shared browser, accessibility-driven desktop control, then pixels. At Michel
`402865d` it names `vercel-labs/agent-desktop` as the near-term driver; cua is not mentioned there. The owner wants
anyagent to be compatible with **cua**.

Verified in `trycua/cua@6d840c5` (2026-11-06), `README.md` and `libs/cua-driver/README.md`:

- **Cua Driver**: "Give your agent tools to inspect and operate native desktop apps and browsers on macOS, Windows, and
  Linux. Connect through the CLI, MCP, or typed SDKs." It "speaks MCP over stdio" (`cua-driver mcp`), and background
  delivery lets agents work "without moving your pointer or taking focus when the app and platform support it".
- **Cua SDK and CLI**: sandboxes (`cua sb create ubuntu …`, a gVisor container) and local VMs (Lume on macOS), the same
  API in Python, TypeScript (`@trycua/cua`, 0.11.0 in `libs/cua/typescript`) and Rust. "There is no agent layer in the
  SDK either: drive sandboxes from your own harness." Images with `cua-spacesd` add processes, files, screenshots and
  input.
- **Licences**: the SDK, CLI, Cua Driver and Lume are MIT. Cua Spaces and `cua-spacesd` are FSL-1.1-MIT. The optional
  `cua-perception` extension includes AGPL-3.0 artifacts.

## Decision

1. **Computer use is a tool profile on the node, exposed to harnesses as an MCP server.** Every harness anyagent
   supports can use MCP: CLI harnesses natively, the OpenAI-compatible loop through Michel's MCP bridge. Node config
   declares profiles, for example:
   - `desktop` → `cua-driver mcp` on the node's own desktop;
   - `sandbox:<name>` → a cua sandbox or VM created with the cua SDK, driven through `cua-spacesd` or `cua-driver`
     inside it.

   `aa_agent.aa_tools` lists the profiles an agent may use; the node must have them.
2. **Isolation first.** The default target is a sandbox or VM, created per agent or per task. Driving a person's own
   desktop is opt-in twice: the node config must enable `desktop`, and the agent must list it.
3. **Approvals.** Computer-use tools are never inherently safe. On a person's own desktop every action session needs a
   human approval (a hard floor, [ADR 0015](0015-decision-model-for-approvals.md)). In a sandbox, `auto` mode's decision
   model may approve within the criteria set `computer_use`.
4. **Generic seam.** cua is the first implementation of a `computer` tool-profile kind. Michel's `agent-desktop` choice
   fits the same seam as a second kind, so the two projects stay compatible.
5. **Distribution.** anyagent depends on nothing from cua at build time. It launches what the person installed (cua
   CLI, driver, Spaces). It never bundles FSL or AGPL parts.

## Consequences

- Agents can operate GUIs, browsers and desktop apps on nodes with cua installed, with screenshots needing a
  vision-capable model ([ADR 0014](0014-model-endpoints-local-and-cloud.md)).
- Sandboxes cost disk and memory per agent or task. Spike 014 measures a Linux sandbox and a macOS VM on one node.
- Computer use on a person's desktop stays slow (human approval) by design.

## Extension points

- Tool-profile kinds: `computer` (cua driver, cua sandbox, later agent-desktop), `browser`, and generic MCP servers.
- Screenshots and recordings could be attached to the `aa_task` as files (Anytype file objects) for review.

## Not generalised

- No live view of a desktop inside Anytype. People use cua's own viewers.
- No Windows nodes in the first computer-use milestone.
