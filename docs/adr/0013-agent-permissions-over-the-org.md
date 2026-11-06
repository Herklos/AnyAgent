# ADR 0013: Agents may change the org according to their permissions

- Status: accepted (owner, 2026-11-06, answer to Q4: "depends on their permissions")
- Date: 2026-11-06

## Context

Q4 asked whether agents may create, edit or archive `aa_agent`, `aa_group`, `aa_schedule` and `aa_trigger` objects (an
org that changes itself), or only people. The owner answered that it depends on each agent's permissions.

Three layers can limit what an agent writes:

1. **Anytype**, for everything an account does: an account is either a member of a space or not, and its API key is
   read-only or read-write ("Every key is limited to the spaces and permission you choose", anytype-cli README, "API
   Keys"). Per-member roles in a space are believed to exist but are not yet checked through the API (spike 002).
   These limits are enforced by Anytype, but they apply per account, not per agent.
2. **anyagent's write path on the node.** All agent writes go through node code: the egress activity and the Anytype
   tool anyagent gives the harness. This can check each write per agent, but agents sharing an account share its key
   ([ADR 0005](0005-identity-agents-map-to-accounts.md)).
3. **The gateway**, which decides whether an edit takes effect (routing, schedule reconciling), can ignore edits by an
   unauthorised author, if it can tell who edited an object (spike 005).

## Decision

1. **Permissions are data on the agent.** `aa_agent.aa_permissions` lists what the agent may do without asking, and
   `aa_permissions_ask` lists what it may do after an approval ([ADR 0008](0008-approvals-objects-and-reactions.md)).
   Anything not listed is refused. Permission ids, in v0:

   | Permission | Allows | Default |
   | --- | --- | --- |
   | `task.create` | Create `aa_task` in groups it belongs to | yes |
   | `schedule.self` | Create, edit, enable or disable `aa_schedule` it owns | yes |
   | `schedule.reports` | The same for agents that report to it, transitively | no |
   | `trigger.self` | Create or edit `aa_trigger` it owns. A new webhook trigger stays inert until a person puts its secret in the gateway config | no |
   | `agent.create` | Create an `aa_agent` in `draft` that reports to itself | no |
   | `agent.activate` | Move an agent it created or that reports to it to `live`, `paused` or `archived` | no |
   | `agent.edit.self` | Edit its own prompt, model, effort and session scope | no |
   | `agent.edit.reports` | Edit those fields and the node and harness of agents that report to it | no |
   | `group.edit` | Create groups it leads; edit members, routing and purpose of groups it leads | no |

   The defaults are what Q4 proposed: agents create tasks and their own schedules, and people edit agents and groups.
2. **No permission grants these; only people write them:** `aa_permissions`, `aa_permissions_ask`,
   `aa_approval_mode`, `aa_account`, `aa_approvers`, `aa_allowed_authors`, the space's `aa_settings`, and any approval
   decision. An agent therefore cannot give itself or anyone else more rights, change who approves, or change which
   account it writes as.
3. **Enforcement, in order:**
   - **Account and key** (Anytype). An agent that must never write runs on an account with a read-only key.
   - **Node write path** (anyagent). The node's Anytype tool and egress activity check the permission before each
     write. The harness never receives the read-write key: it stays in the node's environment and is stripped from the
     environment of harness processes.
   - **Gateway** (anyagent, when spike 005 shows the author of an edit). An org change made by an agent account
     without the permission is not routed and not reconciled, and a node posts a notice. Without author information,
     this layer is absent and the node layer stands alone.
4. Changes to the org by agents are visible like any other change: Anytype history, a chat notice from the node, and
   the next turn of affected agents reads the new configuration ([ARCHITECTURE.md](../ARCHITECTURE.md) §7).

## Consequences

- An org can let its leads hire and tune their own reports while people keep control of rights, approvals and accounts.
- On a shared account, permissions are enforced by anyagent's code, not by Anytype. A harness that escapes its sandbox
  could write with the account's rights. The trust boundary stays the account ([ADR 0005](0005-identity-agents-map-to-accounts.md)):
  put agents with different rights on different accounts when that matters.
- Each permission check is a pure function of (agent, permissions, object, change), tested from a table (spike 013).

## Extension points

- New permission ids are registry entries `{id, objectType, fields, scope}`. Scopes are `self`, `reports` and `group`.
- Per-group permissions (an agent with rights in one group only) can be added as a scope.

## Not generalised

- No role objects (named bundles of permissions) in v0; permissions are listed per agent.
- No delegation chains beyond `reports_to`.
