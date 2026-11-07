# Third-party notices

## Herklos/Michel (Apache-2.0)

Copied at commit `402865d` for WP4 harness adapters and command floor.

| AnyBot path | Michel path |
| --- | --- |
| `packages/harness/src/types.ts` | `packages/harness/adapters/src/types.ts` |
| `packages/harness/src/jsonrpc-child.ts` | `packages/harness/adapters/src/jsonrpc-child.ts` |
| `packages/harness/src/acp.ts` | `packages/harness/adapters/src/acp.ts` |
| `packages/harness/src/codex.ts` | `packages/harness/adapters/src/codex.ts` |
| `packages/harness/src/registry.ts` | `packages/harness/adapters/src/registry.ts` |
| `packages/harness/src/fake-agent.ts` | `packages/harness/adapters/src/fake-agent.ts` |
| `packages/harness/src/fake-agent-main.ts` | `packages/harness/adapters/src/fake-agent-main.ts` |
| `packages/core/src/floor/command-floor.ts` | `packages/core/src/command-floor.ts` |
| `packages/core/src/floor/command-policy.ts` | `packages/core/src/command-policy.ts` |
| `packages/core/src/floor/path-policy.ts` | `packages/core/src/path-policy.ts` |

Not copied (deliberate): Michel OpenAI adapter, OpenCode descriptor, hub/storage/app packages.

New AnyBot code (not from Michel): `headless-cli.ts` (Vibe), `home.ts`, `config-guard.ts`, `permission.ts`.

Dependency: `@agentclientprotocol/claude-agent-acp` exactly `0.99.1`.
