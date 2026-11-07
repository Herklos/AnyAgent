import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const TUNING_DEFAULTS = {
  turnTimeoutMin: 60,
  rotateAfterAccepted: 1500,
  maxMessageChars: 8000,
  /** Must stay below turnTimeoutMin (doctor WP3). */
  approvalTtlMinutes: 30,
} as const;

const OrgSchema = z
  .object({
    id: z.string().min(1),
    backend: z.object({
      kind: z.literal("anytype"),
      url: z.string().min(1),
      readKeyEnv: z.string().min(1),
      writeKeyEnv: z.string().min(1),
    }),
    space: z.string().min(1),
    owners: z.array(z.string()).optional(),
  })
  .strict();

const ConfigSchema = z
  .object({
    version: z.literal(1),
    temporal: z
      .object({
        address: z.string(),
        namespace: z.string(),
        tls: z.boolean().optional(),
        apiKeyEnv: z.string().optional(),
      })
      .strict(),
    state: z.object({ dir: z.string() }).strict(),
    node: z
      .object({
        handle: z.string().regex(/^[a-z][a-z0-9-]*$/, "node.handle must be lowercase"),
        workdirRoots: z.array(z.string()).default(["~"]),
      })
      .strict(),
    tuning: z
      .object({
        turnTimeoutMin: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
        rotateAfterAccepted: z.number().int().positive().max(100_000).optional(),
        maxMessageChars: z.number().int().positive().max(1_000_000).optional(),
        approvalTtlMinutes: z
          .number()
          .int()
          .positive()
          .max(24 * 60)
          .optional(),
      })
      .strict()
      .optional(),
    orgs: z.array(OrgSchema).min(1),
    harnesses: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** Collect duplicate org ids from raw YAML so they report with other schema errors. */
function duplicateOrgIdMessages(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("orgs" in data)) return [];
  const orgs = (data as { orgs: unknown }).orgs;
  if (!Array.isArray(orgs)) return [];
  const seen = new Map<string, number>();
  const msgs: string[] = [];
  for (let i = 0; i < orgs.length; i++) {
    const row = orgs[i];
    if (!row || typeof row !== "object" || !("id" in row)) continue;
    const id = String((row as { id: unknown }).id);
    const prev = seen.get(id);
    if (prev !== undefined) {
      msgs.push(`orgs.${i}.id: duplicate org id "${id}" (also at index ${prev})`);
    } else {
      seen.set(id, i);
    }
  }
  return msgs;
}

export type AnyagentConfig = Omit<z.infer<typeof ConfigSchema>, "tuning"> & {
  tuning: {
    turnTimeoutMin: number;
    rotateAfterAccepted: number;
    maxMessageChars: number;
    approvalTtlMinutes: number;
  };
};

export { TUNING_DEFAULTS };

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

export function loadConfig(path: string): AnyagentConfig {
  const raw = readFileSync(path, "utf8");
  const data: unknown = parseYaml(raw);
  const parsed = ConfigSchema.safeParse(data);
  const dupMsgs = duplicateOrgIdMessages(data);
  if (!parsed.success) {
    const msgs = [
      ...parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      ...dupMsgs,
    ];
    throw new Error(`config invalid:\n- ${msgs.join("\n- ")}`);
  }
  if (dupMsgs.length) {
    throw new Error(`config invalid:\n- ${dupMsgs.join("\n- ")}`);
  }
  const cfg = parsed.data;
  const stateDir = expandHome(cfg.state.dir);
  const workdirRoots = cfg.node.workdirRoots.map(expandHome);
  const rootErrors: string[] = [];
  if (!isAbsolute(stateDir)) {
    rootErrors.push(`state.dir: must be absolute after ~ expansion, got "${stateDir}"`);
  }
  for (let i = 0; i < workdirRoots.length; i++) {
    if (!isAbsolute(workdirRoots[i]!)) {
      rootErrors.push(
        `node.workdirRoots.${i}: must be absolute after ~ expansion, got "${workdirRoots[i]}"`,
      );
    }
  }
  if (rootErrors.length) {
    throw new Error(`config invalid:\n- ${rootErrors.join("\n- ")}`);
  }
  return {
    ...cfg,
    state: { dir: stateDir },
    node: {
      ...cfg.node,
      workdirRoots,
    },
    tuning: {
      turnTimeoutMin: cfg.tuning?.turnTimeoutMin ?? TUNING_DEFAULTS.turnTimeoutMin,
      rotateAfterAccepted: cfg.tuning?.rotateAfterAccepted ?? TUNING_DEFAULTS.rotateAfterAccepted,
      maxMessageChars: cfg.tuning?.maxMessageChars ?? TUNING_DEFAULTS.maxMessageChars,
      approvalTtlMinutes: cfg.tuning?.approvalTtlMinutes ?? TUNING_DEFAULTS.approvalTtlMinutes,
    },
  };
}
