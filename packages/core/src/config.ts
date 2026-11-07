import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

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
        turnTimeoutMin: z.number().optional(),
        rotateAfterAccepted: z.number().optional(),
        maxMessageChars: z.number().optional(),
      })
      .strict()
      .optional(),
    orgs: z.array(OrgSchema).min(1),
    harnesses: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type AnyagentConfig = z.infer<typeof ConfigSchema>;

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

export function loadConfig(path: string): AnyagentConfig {
  const raw = readFileSync(path, "utf8");
  const data: unknown = parseYaml(raw);
  const parsed = ConfigSchema.safeParse(data);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    // Report every problem at once
    throw new Error(`config invalid:\n- ${msgs.join("\n- ")}`);
  }
  const cfg = parsed.data;
  const ids = cfg.orgs.map((o) => o.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("config invalid:\n- orgs: duplicate org ids");
  }
  return {
    ...cfg,
    state: { dir: expandHome(cfg.state.dir) },
    node: {
      ...cfg.node,
      workdirRoots: cfg.node.workdirRoots.map(expandHome),
    },
  };
}
