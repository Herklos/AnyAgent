import type { Backend, SchemaAdmin, TypeDef } from "@anyagent/backend";
import { V0_SCHEMA, V0_SCHEMA_VERSION } from "@anyagent/core";

export interface InitReport {
  schema: "created" | "unchanged" | "would-create";
  settings: "created" | "unchanged" | "would-create";
  /** Types/fields that would be (or were) ensured. */
  plan?: Array<{ type: string; fields: string[] }>;
  message: string;
}

function planFromSchema(defs: TypeDef[]) {
  return defs.map((d) => ({ type: d.key, fields: d.fields.map((f) => f.key) }));
}

export async function initOrg(
  backend: Backend & SchemaAdmin,
  opts: { checkOnly?: boolean } = {},
): Promise<InitReport> {
  const existing = await backend.org.list("aa_settings");
  if (existing.length > 0) {
    const ver = String(existing[0]?.fields.aa_schema_version ?? "");
    if (ver && compareSemver(ver, V0_SCHEMA_VERSION) > 0) {
      throw new Error(
        `space schema version ${ver} is newer than this program (${V0_SCHEMA_VERSION}); upgrade anyagent`,
      );
    }
  }

  const plan = planFromSchema(V0_SCHEMA);
  const settingsMissing = existing.length === 0;

  if (opts.checkOnly) {
    return {
      schema: settingsMissing ? "would-create" : "unchanged",
      settings: settingsMissing ? "would-create" : "unchanged",
      plan,
      message: settingsMissing
        ? `check only: would ensure ${plan.length} types and create aa_settings`
        : "check only: nothing to do",
    };
  }

  const beforeSettings = await backend.org.list("aa_settings");
  await backend.ensureSchema(V0_SCHEMA);

  let settings: "created" | "unchanged" = "unchanged";
  let schema: "created" | "unchanged" = beforeSettings.length === 0 ? "created" : "unchanged";

  const settingsList = await backend.org.list("aa_settings");
  if (settingsList.length === 0) {
    await backend.objects.create("aa_settings", {
      name: "anyagent settings",
      fields: { aa_schema_version: V0_SCHEMA_VERSION },
    });
    settings = "created";
    schema = "created";
  }

  const msg =
    schema === "unchanged" && settings === "unchanged"
      ? "nothing to do"
      : `schema=${schema} settings=${settings}`;
  return { schema, settings, plan, message: msg };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
