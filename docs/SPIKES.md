# Spikes

A spike proves one thing, lives in `spikes/NNN-name/`, runs with one command, and its README says what it proved and
what it did not.

| # | Question | Status | Result |
| --- | --- | --- | --- |
| 001 | Can TypeScript consume Anytype's realtime v2 streams (chat and objects) like Go? | **done** | Yes, against a mock of heart's exact framing: 9/9 checks ([spikes/001-ts-sse](../spikes/001-ts-sse/)). Not against a live server. |
| 002 | Does spike 001's client work against a live `anytype serve`? Bot account, join by invite, read-only and read-write keys, both streams, `Last-Event-ID` resume, `?reactions=full`, the real JSON names of search-stream events | planned | Needs the anytype-cli binary and network access to the Anytype sync network from the test machine |
| 003 | What does one `anytype serve` cost (RSS, CPU idle, disk) per account, and can several run on one machine with different data dirs and listen addresses? | planned | Tells people the cost of each account setup ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)) |
| 004 | Gateway → Temporal: `signalWithStart` per event with idempotency keys, cursor commit after acceptance, crash between signal and commit re-delivers and the workflow drops the repeat | planned | Temporal test server, mock heart from 001 |
| 005 | Can we tell **who** edited an object (for approvals by object edit)? `last_modified_by` on the object, or the change history | planned | If not, approvals by edit are dropped and only reactions count |
| 006 | Agent workflow on `@temporalio/workflow`: coalescing, permission update + approval wait, `continueAsNew` between turns, time-skipping tests | planned | Validates [ADR 0010](adr/0010-reuse-michel-adapters-own-the-workflow.md) |
| 007 | Michel's adapters copied as a package: Claude Code over ACP and the OpenAI-compatible loop drive one turn from an activity | planned | Uses the fake agent in CI, real harnesses opt-in |
| 008 | Two nodes, one gateway, one space: the v0 slice end to end | planned | See [ROADMAP.md](ROADMAP.md) |
| 009 | Schema bootstrap: create the `aa_*` types, properties and Queries through the v2 API, idempotently | planned | |
| 010 | Can one account be logged in by `anytype serve` on two machines at once (multi-device), or must a shared account use one remote `anytype serve`? | planned | Decides how the one-account setup spans several nodes ([ADR 0005](adr/0005-identity-agents-map-to-accounts.md)) |
| 011 | Identity resolution table test: person, exclusive agent account, shared account with and without tag, approver that is an agent account (refused) | planned | Pure function; runs in CI |
