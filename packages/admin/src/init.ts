import type { Backend, SchemaAdmin, TypeDef } from "@anyagent/backend";
import { resolveApprovers, SCHEMA_VERSION, V0_SCHEMA } from "@anyagent/core";

export interface InitReport {
  schema: "created" | "unchanged" | "upgraded" | "would-create" | "would-upgrade";
  settings: "created" | "unchanged" | "updated" | "would-create" | "would-update";
  /** Types/fields that would be (or were) ensured. */
  plan?: Array<{ type: string; fields: string[] }>;
  message: string;
  schemaVersion?: string;
  approvers?: string[];
}

export interface InitOrgOpts {
  checkOnly?: boolean;
  /** Space owner participant ids (default approvers). */
  ownerIds?: string[];
  /** Agent account ids refused as approvers. */
  agentAccounts?: string[];
}

function planFromSchema(defs: TypeDef[]) {
  return defs.map((d) => ({ type: d.key, fields: d.fields.map((f) => f.key) }));
}

export async function initOrg(
  backend: Backend & SchemaAdmin,
  opts: InitOrgOpts = {},
): Promise<InitReport> {
  const existing = await backend.org.list("aa_settings");
  if (existing.length > 0) {
    const ver = String(existing[0]?.fields.aa_schema_version ?? "");
    if (ver && compareSemver(ver, SCHEMA_VERSION) > 0) {
      throw new Error(
        `space schema version ${ver} is newer than this program (${SCHEMA_VERSION}); upgrade anyagent`,
      );
    }
  }

  const plan = planFromSchema(V0_SCHEMA);
  const settingsMissing = existing.length === 0;
  const currentVer = settingsMissing ? "" : String(existing[0]?.fields.aa_schema_version ?? "");
  const needsUpgrade =
    !settingsMissing && (!currentVer || compareSemver(currentVer, SCHEMA_VERSION) < 0);

  if (opts.checkOnly) {
    if (settingsMissing) {
      return {
        schema: "would-create",
        settings: "would-create",
        plan,
        message: `check only: would ensure ${plan.length} types and create aa_settings @ ${SCHEMA_VERSION}`,
        schemaVersion: SCHEMA_VERSION,
      };
    }
    if (needsUpgrade) {
      return {
        schema: "would-upgrade",
        settings: "would-update",
        plan,
        message: `check only: would upgrade schema ${currentVer || "unknown"} → ${SCHEMA_VERSION}`,
        schemaVersion: SCHEMA_VERSION,
      };
    }
    return {
      schema: "unchanged",
      settings: "unchanged",
      plan,
      message: "check only: nothing to do",
      schemaVersion: currentVer || SCHEMA_VERSION,
    };
  }

  const beforeSettings = await backend.org.list("aa_settings");
  await backend.ensureSchema(V0_SCHEMA);

  let settings: InitReport["settings"] = "unchanged";
  let schema: InitReport["schema"] = beforeSettings.length === 0 ? "created" : "unchanged";

  const self = await backend.identity.self();
  const owners = opts.ownerIds?.length ? opts.ownerIds : [self.id];
  // Only treat accounts as agents when the caller says so (CLI passes write-key self).
  const agentAccounts = opts.agentAccounts ?? [];
  const resolved = resolveApprovers({
    settingsApprovers: "",
    owners,
    agentAccounts,
  });
  // Refuse agent accounts at init: resolved already drops them.
  const defaultApprovers = resolved.approvers.join(",");

  const settingsList = await backend.org.list("aa_settings");
  if (settingsList.length === 0) {
    await backend.objects.create("aa_settings", {
      name: "anyagent settings",
      fields: {
        aa_schema_version: SCHEMA_VERSION,
        aa_approvers: defaultApprovers,
      },
    });
    settings = "created";
    schema = "created";
  } else {
    const row = settingsList[0]!;
    const ver = String(row.fields.aa_schema_version ?? "");
    const patch: Record<string, string> = {};
    if (!ver || compareSemver(ver, SCHEMA_VERSION) < 0) {
      patch.aa_schema_version = SCHEMA_VERSION;
      schema = "upgraded";
    }
    const currentApprovers = String(row.fields.aa_approvers ?? "");
    if (!currentApprovers.trim()) {
      // Validate configured list would not be all agents when setting defaults.
      const check = resolveApprovers({
        settingsApprovers: defaultApprovers,
        owners,
        agentAccounts,
      });
      if (check.refused.some((r) => r.reason === "agent-account")) {
        // Still set the filtered list.
      }
      patch.aa_approvers = check.approvers.join(",");
    } else {
      // Refuse agent accounts already in the list: rewrite without them.
      const cleaned = resolveApprovers({
        settingsApprovers: currentApprovers,
        owners,
        agentAccounts,
      });
      if (cleaned.refused.some((r) => r.reason === "agent-account")) {
        patch.aa_approvers = cleaned.approvers.join(",");
      }
    }
    if (Object.keys(patch).length > 0) {
      await backend.objects.update(row.id, patch);
      if (settings === "unchanged") settings = "updated";
    }
  }

  const finalSettings = await backend.org.list("aa_settings");
  const finalApprovers = String(finalSettings[0]?.fields.aa_approvers ?? "");
  const finalVer = String(finalSettings[0]?.fields.aa_schema_version ?? SCHEMA_VERSION);

  const msg =
    schema === "unchanged" && settings === "unchanged"
      ? "nothing to do"
      : `schema=${schema} settings=${settings} version=${finalVer}`;
  return {
    schema,
    settings,
    plan,
    message: msg,
    schemaVersion: finalVer,
    approvers: finalApprovers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
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
