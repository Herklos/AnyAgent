/**
 * Temporal workflow bundle entry.
 * Product workflows must be exported from this module for the worker bundler.
 */
export { AnyBot } from "./anybot-workflow.js";

/** WP0 smoke — kept so early bundler tests still resolve. */
export async function wp0SmokeWorkflow(): Promise<string> {
  return "ok";
}
