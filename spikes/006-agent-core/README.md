# Spike 006: AgentCore history cost

**Question.** How many Temporal history events (and bytes) per admitted chat message does our own `AgentCore` use?

**Answer (2026-11-07).** Measured against `TestWorkflowEnvironment.createLocal()` (Temporal CLI bundled server; CI previously printed Server 1.32.2) with SDK `@temporalio/*@1.24.0`. Fifty messages admitted one at a time via `anyagent.chat`, then close. History fetched with `handle.fetchHistory()`; event count and JSON byte size divided by 50. Replay of that history passes (`Worker.runReplayHistory`, T-WP3-11). Budget for T-WP3-12 is measured × 1.3 ≈ **14.5 events/message**.

| Metric | Estimate | Measured |
| --- | --- | --- |
| Events per message | 8–10 | **11.18** (559 events / 50 messages) |
| Bytes per message | — | **4877** (243849 bytes / 50) |
| Comparison to Michel streaming harness (~160/turn) | own core should be far lower | **~14× lower** than 160 |

Stop condition (>25 events/message): **not hit**.

When re-measured, set the T-WP3-12 budget to measured × 1.3 and refresh this table and
`docs/research/harness-vs-own-vs-framework.md` under **Measured**.
