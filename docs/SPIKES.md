# Spikes

A spike proves one thing, lives in `spikes/NNN-name/`, runs with one command, and its README says what it proved and
what it did not.

| # | Question | Status | Result |
| --- | --- | --- | --- |
| 001 | Can TypeScript consume Anytype's realtime v2 streams (chat and objects) like Go? | **done** | Yes, against a mock of heart's exact framing: 9/9 checks ([spikes/001-ts-sse](../spikes/001-ts-sse/)). Not against a live server. |
| 002 | Does spike 001's client work against a live `anytype serve`? Bot account, join by invite, read-only and read-write keys, both streams, `Last-Event-ID` resume, `?reactions=full`, the real JSON names of search-stream events | planned | Needs the anytype-cli binary and network access to the Anytype sync network from the test machine |
| 003 | What does one `anytype serve` cost (RSS, CPU idle, disk) per account, and can several run on one machine with different data dirs and listen addresses? | planned | Tells people the cost of each account setup ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)) |
| 004 | Gateway → Temporal: update-with-start per event (`updateId` = idempotency key, `waitForStage: ACCEPTED`), cursor commit after acceptance, a crash between update and commit re-delivers and Temporal drops the repeated `updateId`; rotation by close; the same run against a self-hosted server and Temporal Cloud (API key) | planned | Temporal test server, mock heart from 001; finds the minimum self-hosted server version ([ADR 0003](adr/0003-one-shared-temporal-one-workflow-per-agent.md)) |
| 005 | Can we tell **who** edited an object (for approvals by object edit)? `last_modified_by` on the object, or the change history | planned | If not, approvals by edit are dropped and only reactions count |
| 006 | Agent workflow on `@temporalio/agent-harness` 0.3.1 from npm (Temporal SDK pinned to 1.24.0): handlers with `enqueue`, the permission update through the approval gate, auto mode with a fake decision model racing a person, the claim update, the rotation query, time-skipping tests; is one turn per delivery acceptable without coalescing? | planned | Validates [ADR 0010](adr/0010-reuse-michel-adapters-and-the-npm-harness.md) and [ADR 0015](adr/0015-decision-model-for-approvals.md). Install already checked ([research](research/temporal-agent-harness.md)) |
| 007 | Michel's adapters copied as a package: Claude Code over ACP and the OpenAI-compatible loop drive one turn from an activity, the loop against a local `llama-server --jinja` with a tool call | planned | Uses the fake agent in CI, real harnesses and llama.cpp opt-in ([ADR 0014](adr/0014-model-endpoints-local-and-cloud.md)) |
| 008 | Two nodes, one gateway, one space: the v2 slice end to end | planned | See [ROADMAP.md](ROADMAP.md) |
| 009 | Schema bootstrap: create the `aa_*` types, properties and Queries through the v2 API, idempotently | planned | |
| 010 | Can one account be logged in by `anytype serve` on two machines at once (multi-device), or must a shared account use one remote `anytype serve`? | planned | Decides how the one-account setup spans several nodes ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)) |
| 011 | Identity resolution table test: person, exclusive agent account, shared account with and without tag, approver that is an agent account (refused) | planned | Pure function; runs in CI |
| 012 | Spike 002 against a **self-hosted any-sync** (`anytype auth create --network-config`): bot accounts join, both streams work, and an account on another network cannot join the space | planned | [ADR 0012](adr/0012-any-anytype-sync-network.md) |
| 013 | Permission check table test: each permission × object × change, the person-only fields, and `ask` permissions creating an approval | planned | Pure function; runs in CI ([ADR 0013](adr/0013-agent-permissions-over-the-org.md)) |
| 014 | Computer use with cua: a harness drives a cua Linux sandbox through MCP for one task with approvals; cost of a sandbox and a macOS VM per node | planned, after v0 | [ADR 0016](adr/0016-computer-use-with-cua.md) |
| 015 | Decision model quality: a small local model on `llama-server` and a cloud model judge a fixed set of tool calls against criteria; escalation and refusal rates, latency | planned | [ADR 0015](adr/0015-decision-model-for-approvals.md) |
| 016 | The backend port against `any`: a local `any` server (developer preview) on a throwaway account and space, read one org written in the `aa_*` schema, stream chat and object changes, post and react; the port's conformance suite passes or the gaps are listed | **done** | Yes for one account on a placeholder network: 17/17 against `any`, 16/16 (1 skipped) against the in-memory reference, and the suite fails on broken backends. Resume by `_applySeq`, a group can be its own chat, no compare-and-set on properties. Not proven: a second author, sync, anytype-heart ([spikes/016-backend-port-any](../spikes/016-backend-port-any/)) |

**Needed first, by release** ([ROADMAP.md](ROADMAP.md)): v0: 002, 004, 006 (chat handler), 007 (Claude Code, read-only), 009.
v1: 006 (approvals), 011 (approvers), 007 (OpenAI loop), 012. v2: 008, 011 in full, 003 and 010 as needed. v3: 013, 015.
After v3: 014. Done: 001, 016.
