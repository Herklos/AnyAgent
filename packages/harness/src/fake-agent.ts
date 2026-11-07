/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/harness/adapters/src/fake-agent.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; package rename; drop openai/opencode coupling
 */

// The script format of the fake ACP agent (audit G65). Tests write a script file and point
// ANYAGENT_FAKE_SCRIPT at it; every run is deterministic and needs no model.

export type FakeStep =
  | { say: string }
  | { think: string }
  | { sleep: number }
  | { usage: { input: number; output: number; costUsd?: number } }
  | {
      /** A tool call. With `permission` the agent asks first and acts only if allowed. */
      tool: {
        id: string;
        title: string;
        kind?: string;
        rawInput?: unknown;
        permission?: boolean;
        /** Side effects, applied only when allowed: they are recorded in the state dir's effects.log. */
        effect?: { writeFile?: { path: string; content: string }; log?: string };
      };
    }
  | {
      /** Exit hard (SIGKILL-like) once: the marker file makes it fire on the first run only. */
      crash: { marker: string; code?: number };
    };

export interface FakeTurn {
  /** Applies to a prompt containing this text; the last turn without `match` is the default. */
  match?: string;
  steps: FakeStep[];
}

export interface FakeScript {
  turns: FakeTurn[];
  /** Capabilities reported at initialize. */
  capabilities?: { loadSession?: boolean; resume?: boolean };
  /** Sign-in methods listed at initialize; `session/new` then needs an `authenticate` call naming one of them. */
  authMethods?: string[];
}
