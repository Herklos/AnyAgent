# v0 → v1 carry-over

Source: [`docs/roadmap/v0/REPORT.md`](../v0/REPORT.md) and [`docs/roadmap/v0/STATUS.md`](../v0/STATUS.md) (2026-11-07). Every open item from v0 has an owner package below; nothing is silently dropped.

| Item | Source | Owner (v1 WP or later) |
| --- | --- | --- |
| Live Anytype / spike 002 (`anytype serve`, streams, verified adapter) | REPORT live; WP1 STATUS | **WP7** (self-hosted any-sync half) + later live; adapter `verified: false` until then |
| Spike 004 Cloud / self-hosted Temporal min version | REPORT; WP5 STATUS | **WP7** |
| Live Claude Code `read_only` matrix | REPORT; WP4 | **later** (live acceptance before claiming ship) — also blocks “live v0” tag |
| Live Codex `read_only` matrix | REPORT; WP4 | **later** (same) |
| Process-level `kill -9` of `anybot run` | REPORT check 5 | **WP8** acceptance (v1) or later |
| Two-org bonus (REPORT check 8) | REPORT | **WP7** |
| Grok Build + Vibe: `shipping: v1` until live spike 007 | REPORT limitations; WP4 registry | **WP5** / live spike 007 — still deferred until live PASS |
| Event age at delivery not measured live | REPORT measured | **WP7** (Cloud path) or later |
| Time to first reply (live) NOT RUN | REPORT | **later** (live acceptance) |
| Anyone with write access can change agent settings if last-modifier invisible (D10 warn) | REPORT limitations | **WP3** (approvals/approvers) / spike 005 — still open |
| `fetch` denied in `read_only` | REPORT limitations | keep (v0 policy); revisit only if owner asks |
| Replies are one final message (no streaming) | REPORT; Q13 settled | keep |
| Deliver can duplicate once across crash window | REPORT limitations | keep (documented); harden in later if needed |
| Adapter `verified: false` until spike 002 | REPORT limitations; WP1 | until live Anytype |
| Automated suite uses in-process Temporal + MemoryBackend + fake (not child `anybot run` + mock-heart) | REPORT deviations | **later** / optional process-level in v1 WP8 |
| ADR 0019 harness vs own gate decision | REPORT Q2; ADR 0019 | **WP1** (this package) → ADR 0021 |
| Owner: fakes-only tag vs wait for live PASS | REPORT Q1 | owner; does not block v1 WP1–WP2 on own gate |
| Owner: ship Claude/Codex after one live PASS or full matrix twice | REPORT Q3 | owner / live procedure |
| Spike 006 approval / auto / claim halves | SPIKES 006 partial | **WP2** (gate), **WP3** (Anytype), v3 for auto |
| Spike 011 approver identity | SPIKES | **WP3** |
| Spike 007 OpenAI-compatible loop half | SPIKES | **WP5** |
| Spike 009/005 live schema / last-modifier | WP2 STATUS | live Anytype / **WP3** |
| Pin `@temporalio/*` at 1.24.0 until gate decision | AGENTS.md rule 8; ADR 0019 | **WP1** (propose only; owner confirms pin move) |
