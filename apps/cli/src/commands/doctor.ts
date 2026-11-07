import { createBackends, selectOrgs } from "../backends.js";
import { loadDiscoveredConfig } from "../config-discovery.js";
import { runDoctor } from "../doctor/run-doctor.js";

export async function cmdDoctor(opts: {
  config?: string;
  org?: string;
  json?: boolean;
}): Promise<number> {
  const { path, config } = loadDiscoveredConfig(opts.config);
  const orgs = selectOrgs(config, opts.org);
  const backends = createBackends(config);
  const report = await runDoctor({
    config,
    configPath: path,
    backends,
    orgIds: orgs.map((o) => o.id),
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const c of report.checks) {
      const tag = c.severity.toUpperCase().padEnd(4);
      process.stdout.write(`${tag} ${c.id}  ${c.message}\n`);
      if (c.fix && c.severity !== "pass") process.stdout.write(`     fix: ${c.fix}\n`);
    }
    process.stdout.write(report.ok ? "doctor: ok\n" : "doctor: failed\n");
  }
  return report.ok ? 0 : 1;
}
