import { createAgent, listAgents } from "@anyagent/admin";
import type { ApprovalMode, HarnessId } from "@anyagent/core";
import { createBackends, selectOrgs } from "../backends.js";
import { loadDiscoveredConfig } from "../config-discovery.js";
import { info } from "../logging.js";

const HARNESSES = new Set(["claude-code", "codex", "grok", "vibe", "fake"]);

export async function cmdAgentCreate(opts: {
  handle: string;
  harness: string;
  model?: string;
  mode?: string;
  workdir?: string;
  allowedAuthors?: string;
  org?: string;
  config?: string;
}): Promise<number> {
  if (!HARNESSES.has(opts.harness)) {
    process.stderr.write(`unknown harness: ${opts.harness}\n`);
    return 1;
  }
  const { config } = loadDiscoveredConfig(opts.config);
  const orgs = selectOrgs(config, opts.org);
  if (orgs.length !== 1 && !opts.org) {
    process.stderr.write("pass --org when more than one org is configured\n");
    return 2;
  }
  const org = orgs[0]!;
  const backends = createBackends(config);
  const backend = backends.get(org.id)!;
  // Ensure schema exists for create.
  const { initOrg } = await import("@anyagent/admin");
  await initOrg(backend);

  try {
    const created = await createAgent(backend, {
      handle: opts.handle,
      harness: opts.harness as HarnessId,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.mode ? { mode: opts.mode as ApprovalMode } : {}),
      ...(opts.workdir ? { workdir: opts.workdir } : {}),
      ...(opts.allowedAuthors
        ? {
            allowedAuthors: opts.allowedAuthors
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
    });
    info({ cmd: "agent.create", org: org.id, handle: opts.handle, agentId: created.agentId });
    process.stdout.write(
      `created ${opts.handle} (${created.agentId})\nchat: ${created.chatId}\nopen the chat in Anytype to talk to the agent\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export async function cmdAgentList(opts: { org?: string; config?: string }): Promise<number> {
  const { config } = loadDiscoveredConfig(opts.config);
  const orgs = selectOrgs(config, opts.org);
  const backends = createBackends(config);
  for (const org of orgs) {
    const backend = backends.get(org.id)!;
    const agents = await listAgents(backend);
    process.stdout.write(`# org ${org.id}\n`);
    if (agents.length === 0) {
      process.stdout.write("(no agents)\n");
      continue;
    }
    for (const a of agents) {
      if (a.error) {
        process.stdout.write(`${a.id}\terror\t${a.error}\n`);
      } else if (a.spec) {
        process.stdout.write(
          `${a.spec.handle}\t${a.spec.harness}\t${a.spec.approvalMode}\t${a.spec.lifecycle}\n`,
        );
      }
    }
  }
  return 0;
}
