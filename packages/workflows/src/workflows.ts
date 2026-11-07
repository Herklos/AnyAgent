/**
 * Temporal workflow bundle entry.
 * Product workflows must be exported from this module for the worker bundler.
 */
export { AnyBot } from "./anybot-workflow.js";
export { ScheduleKick } from "./schedule-kick.js";
export { ScheduleProjection } from "./schedule-projection.js";

/** WP0 smoke — kept so early bundler tests still resolve. */
export async function wp0SmokeWorkflow(): Promise<string> {
  return "ok";
}
