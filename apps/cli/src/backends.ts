import type { Backend, SchemaAdmin } from "@anyagent/backend";
import { MemoryBackend } from "@anyagent/backend";
import { createAnytypeAdapter } from "@anyagent/backend-anytype";
import type { AnyagentConfig } from "@anyagent/core";

export type OrgBackend = Backend & SchemaAdmin & { meta?: { verified?: boolean } };

/** Process-local memory backends so CLI commands in one process share state (tests). */
const memoryBackends = new Map<string, OrgBackend>();

export function resetMemoryBackends(): void {
  memoryBackends.clear();
}

export function createBackends(
  config: AnyagentConfig,
  opts?: { memoryForTests?: boolean },
): Map<string, OrgBackend> {
  const map = new Map<string, OrgBackend>();
  for (const org of config.orgs) {
    if (opts?.memoryForTests || process.env.ANYBOT_BACKEND === "memory") {
      let b = memoryBackends.get(org.id);
      if (!b) {
        b = new MemoryBackend() as OrgBackend;
        memoryBackends.set(org.id, b);
      }
      map.set(org.id, b);
      continue;
    }
    const readKey = process.env[org.backend.readKeyEnv];
    const writeKey = process.env[org.backend.writeKeyEnv];
    const key = writeKey || readKey;
    if (!key) {
      throw new Error(
        `missing env ${org.backend.writeKeyEnv} (or ${org.backend.readKeyEnv}) for org ${org.id}`,
      );
    }
    const adapter = createAnytypeAdapter({
      url: org.backend.url,
      apiKey: key,
      spaceId: org.space,
    });
    map.set(org.id, adapter as OrgBackend);
  }
  return map;
}

export function selectOrgs(config: AnyagentConfig, orgId?: string) {
  if (!orgId) return config.orgs;
  const org = config.orgs.find((o) => o.id === orgId);
  if (!org) throw new Error(`unknown org id: ${orgId}`);
  return [org];
}
