# ADR 0012: Anytype's network or a self-hosted any-sync, by configuration only

- Status: accepted (owner, 2026-11-06, answer to Q3: "compatible with both")
- Date: 2026-11-06

## Context

An Anytype space syncs through a sync network: Anytype's own, or a self-hosted any-sync. anyagent never talks to the
network. It talks to `anytype serve` processes, one per account ([ADR 0005](0005-identity-agents-map-to-accounts.md)),
and the network is a property of how each account was created and logged in.

Verified in `anyproto/anytype-cli@017b954` (2026-11-05):

- `anytype auth create` and `anytype auth login` take `--network-config <yaml>`: "Path to custom network configuration
  YAML (for self-hosted)" (`cmd/auth/create/create.go`, line 87; `cmd/auth/login/login.go`, line 42).
- The path is saved in the CLI config as `networkConfigPath` (`core/config/config.go`, line 14).
- `anytype space join` resolves the network id from "cached config → YAML file → default Anytype network"
  (`cmd/space/join/join.go`, lines 80–95).

## Decision

1. anyagent has **no network setting of its own**. Choosing a network means creating and logging in each account (the
   agent accounts and the gateway's viewer) with or without `--network-config`. That step is part of the account setup
   people already do (`anytype auth create`, `anytype space join`), documented in the setup guide.
2. Every account of a deployment must be on the **same network as the space**. This is inferred, because a space lives on
   one network, and spike 012 checks it. `anyagent doctor` checks that every configured endpoint and the gateway see the
   same space id and members.
3. The node and gateway config may record `network: anytype | self-hosted` for display only. No code branches on it.
4. v0 is accepted on both networks ([ROADMAP.md](../ROADMAP.md)).

## Consequences

- A self-hosted deployment is fully under the owner's control: Temporal (self-hosted, [ADR 0003](0003-one-shared-temporal-one-workflow-per-agent.md)),
  any-sync, nodes and models.
- anytype-heart's licence grants commercial use "in Allowed Networks" (`LICENSE.md`, lines 7–9). Which network is used
  may matter to whoever runs `anytype serve` commercially. anyagent does not distribute heart and takes no position;
  the setup guide points to the licence.
- Moving a deployment between networks means new accounts and a new space. anyagent's objects move with an export and
  import of the space, and `anyagent rebuild` restores the workflows.

## Extension points

- None needed: the network is outside anyagent's code.

## Not generalised

- No bridging of one deployment across two networks.
