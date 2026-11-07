# Spike 006: AgentCore history cost

**Question.** How many Temporal history events (and bytes) per admitted chat message does our own `AgentCore` use?

**Answer (2026-11-07).** Measurement is gated on a Temporal test server. Unit admission tests always run. The Temporal
contract suite (T-WP3-06+) runs when `TestWorkflowEnvironment.createLocal()` succeeds; otherwise it is reported
**skipped** with the reason and WP8 is blocked for that reason.

| Metric | Estimate | Measured |
| --- | --- | --- |
| Events per message | 8–10 | NOT RUN until Temporal env available |
| Bytes per message | — | NOT RUN |
| Comparison to Michel streaming harness (~160/turn) | own core should be far lower | NOT RUN |

When measured, set the T-WP3-12 budget to measured × 1.3 and record the table here and in
`docs/research/harness-vs-own-vs-framework.md` under **Measured**.
