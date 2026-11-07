/** Package marker for WP0 workspace smoke. */
export const CLI_PACKAGE = "anyagent" as const;

export { runCli } from "./cli.js";
export { discoverConfigPath, loadDiscoveredConfig } from "./config-discovery.js";
export { runDoctor, runGateChecks } from "./doctor/run-doctor.js";
export { showTermsNoticeOnce, TERMS_NOTICE } from "./notice.js";
