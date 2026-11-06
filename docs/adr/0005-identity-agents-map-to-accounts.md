# ADR 0005: Identity: agents map to Anytype accounts by data (one shared, a pool, or one each)

- Status: accepted (owner, 2026-11-06). Supersedes the first version of this ADR ("one account per node now, per agent
  later"): the owner asked for all three setups to work.
- Date: 2026-11-06

## Context

From the anytype-cli README: the headless server "requires a dedicated bot account, which you create using
`anytype auth create`"; a bot account "only has access to spaces it explicitly joins"; API keys are limited to chosen
spaces and to read-only or read-write ("there is no default"). One `anytype serve` process is logged in to one account.
A chat message's author, and a reaction's participant id, are accounts.

The owner wants anyagent to work with:

1. **one Anytype account for all agents**;
2. **one or more accounts shared by the agents** (a pool: per node, per team, any mapping);
3. **one account per agent**.

Building three modes would be three code paths. The three setups differ only in how many agents link the same account.

## Decision

1. **Accounts are objects.** A new type `aa_account` records an Anytype account the agents may write through: its
   `aa_handle` and its `aa_participant_id` in the space ([schema](../specs/schema.md#aa_account)). Every `aa_agent`
   links exactly one `aa_account` (`aa_account`). The three setups are just data:

   | Setup | Data |
   | --- | --- |
   | One account for all agents | every agent links the same `aa_account` |
   | A pool of shared accounts | agents link one of several `aa_account`s, in any mapping |
   | One account per agent | each agent links its own `aa_account` |

   Mixed deployments (some agents alone on an account, others sharing) are valid.

2. **Endpoints are node configuration, not Anytype data.** Each node's config lists the accounts it can write
   through: `{account: <handle>, url: <anytype serve base URL>, keyEnv: <env var holding the read-write key>}`. The URL
   may be a local `anytype serve` (`127.0.0.1:31012`) or a remote one on the private network. An agent can run on a node
   only if that node has an endpoint for the agent's account; the node refuses the turn otherwise, with a notice.
   Secrets never enter Anytype.

3. **Who wrote a message** (the `Identity` port):
   - author's participant id is not any `aa_account` → a **person**;
   - author is an `aa_account` linked by exactly one live agent → **that agent** (the handle tag is optional);
   - author is an `aa_account` shared by several agents → the agent named by the **handle tag** (first line
     `**@handle**`); no valid tag → an **unattributed agent message**: never treated as human, never routed.

4. **Posting.** Agents always post through their account's endpoint. On a shared account the handle tag is mandatory;
   on an exclusive account it is added only when `aa_account.aa_tag_always` is set (useful in one-account setups that
   later split).

5. **People and agents never share an account.** An account linked by any `aa_agent` is an agent account. Bootstrap
   and the gateway refuse an `aa_approvers` list or an `aa_allowed_authors` entry that names an agent account, so an
   agent cannot approve its own request or pass as a person. Consequence: "one account for all agents" means one
   dedicated bot account, not the owner's personal account.

6. **The gateway** reads with any member account and a **read-only** key: a dedicated viewer account (recommended), or a
   read-only key on one of the agent accounts (acceptable in the one-account setup).

## Consequences

- **Trust boundary is the account.** Agents sharing an account can technically post as each other; agents on
  different accounts cannot, because Anytype signs each change with its author's key. Pick the mapping that matches the
  trust you need: shared for convenience, exclusive for accountability.
- **Cost**: one `anytype serve` per account somewhere on the network. One shared account = one process; one per agent =
  N processes (cost measured by [SPIKES.md](../SPIKES.md) 003).
- **One account on several machines**: either all nodes write through one `anytype serve` over the private network, or
  each machine runs its own `anytype serve` logged in to the same account (Anytype's multi-device model; not yet
  verified with the headless CLI: spike 010).
- Avatars and names in chat follow accounts: on a shared account, people tell agents apart by the tag.
- Moving an agent to another account is an edit of `aa_agent.aa_account`; it applies at the next turn.

## Extension points

- `Identity` port with one implementation that covers the three setups; a future per-message signature scheme for
  shared accounts would be a second.
- Endpoint kinds in node config: `http` (v0); an embedded heart later ([ADR 0004](0004-typescript-over-the-http-api.md)).

## Not generalised

- No automatic creation of Anytype accounts or invites: a person runs `anytype auth create` and `anytype space join`,
  then registers the account with `anyagent account add`.
- No per-agent avatars on a shared account.
