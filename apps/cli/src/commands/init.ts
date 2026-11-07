import { initOrg } from "@anyagent/admin";
import { createBackends, selectOrgs } from "../backends.js";
import { loadDiscoveredConfig } from "../config-discovery.js";
import { info } from "../logging.js";
import { showTermsNoticeOnce, TERMS_NOTICE } from "../notice.js";

export async function cmdInit(opts: {
  config?: string;
  org?: string;
  check?: boolean;
}): Promise<number> {
  const { path, config } = loadDiscoveredConfig(opts.config);
  const backends = createBackends(config);
  const orgs = selectOrgs(config, opts.org);
  for (const org of orgs) {
    const backend = backends.get(org.id);
    if (!backend) throw new Error(`no backend for ${org.id}`);
    if (showTermsNoticeOnce(config.state.dir, org.id)) {
      process.stdout.write(`${TERMS_NOTICE}\n`);
    }
    const self = await backend.identity.self();
    const report = await initOrg(backend, {
      checkOnly: opts.check === true,
      ownerIds: org.owners?.length ? org.owners : [self.id],
      agentAccounts: [self.id],
    });
    info({
      cmd: "init",
      org: org.id,
      config: path,
      schema: report.schema,
      settings: report.settings,
      message: report.message,
    });
    process.stdout.write(`[${org.id}] ${report.message}\n`);
  }
  return 0;
}
