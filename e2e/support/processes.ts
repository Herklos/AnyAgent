/**
 * Helpers to spawn `anybot run` and related processes for WP8 process-level tests.
 * Full child-process acceptance against mock-heart is optional in CI; in-process
 * Temporal + MemoryBackend covers the same behavioural checks.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function anybotMainJs(): string {
  return join(root, "apps/cli/dist/main.js");
}

export function spawnAnybot(
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; cwd?: string },
): ChildProcess {
  return spawn(process.execPath, [anybotMainJs(), ...args], {
    cwd: opts?.cwd ?? root,
    env: { ...process.env, ...(opts?.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function waitForExit(child: ChildProcess, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
}

export function killHard(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // already dead
  }
}
