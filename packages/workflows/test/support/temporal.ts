/**
 * Starts TestWorkflowEnvironment.createLocal(), or throws Skipped with a reason.
 * (Also available as e2e/support/temporal.ts for package-wide use.)
 */
import { TestWorkflowEnvironment } from "@temporalio/testing";

export class Skipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "Skipped";
  }
}

export async function withTemporal<T>(
  fn: (env: TestWorkflowEnvironment) => Promise<T>,
): Promise<T> {
  let env: TestWorkflowEnvironment;
  try {
    env = await TestWorkflowEnvironment.createLocal();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Skipped(`Temporal test server unavailable: ${reason}`);
  }
  try {
    return await fn(env);
  } finally {
    await env.teardown();
  }
}
