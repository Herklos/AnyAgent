import type { TypeDef } from "@anyagent/backend";

/** Current schema version (v1 adds aa_approval + aa_approvers). */
export const V0_SCHEMA_VERSION = "0.1.0";
export const V1_SCHEMA_VERSION = "0.2.0";
/** Alias used by init / doctor for "this program's schema". */
export const SCHEMA_VERSION = V1_SCHEMA_VERSION;

export const V0_SCHEMA: TypeDef[] = [
  {
    key: "aa_settings",
    label: "Settings",
    fields: [
      { key: "aa_schema_version", label: "Schema version", format: "text" },
      { key: "aa_approvers", label: "Approvers", format: "text" },
    ],
  },
  {
    key: "aa_agent",
    label: "Agent",
    fields: [
      { key: "aa_handle", label: "Handle", format: "text" },
      {
        key: "aa_harness",
        label: "Harness",
        format: "select",
        options: ["claude-code", "codex", "grok", "vibe", "fake"],
      },
      { key: "aa_model", label: "Model", format: "text" },
      { key: "aa_chat", label: "Chat", format: "text" },
      { key: "aa_workdir", label: "Working directory", format: "text" },
      {
        key: "aa_approval_mode",
        label: "Approval mode",
        format: "select",
        options: ["read_only", "full", "ask"],
      },
      { key: "aa_allowed_authors", label: "Allowed authors", format: "text" },
      {
        key: "aa_lifecycle",
        label: "Lifecycle",
        format: "select",
        options: ["live", "paused"],
      },
    ],
  },
  {
    key: "aa_approval",
    label: "Approval",
    fields: [
      { key: "aa_request_id", label: "Request id", format: "text" },
      { key: "aa_requester", label: "Requester agent id", format: "text" },
      { key: "aa_action", label: "Action summary", format: "text" },
      {
        key: "aa_risk",
        label: "Risk",
        format: "select",
        options: ["low", "medium", "high"],
      },
      {
        key: "aa_status",
        label: "Status",
        format: "select",
        options: ["pending", "approved", "denied", "expired"],
      },
      { key: "aa_message", label: "Chat message ref", format: "text" },
      { key: "aa_expires_at", label: "Expires at", format: "text" },
      { key: "aa_decided_by", label: "Decided by", format: "text" },
      { key: "aa_decided_at", label: "Decided at", format: "text" },
    ],
  },
  {
    key: "aa_schedule",
    label: "Schedule",
    fields: [
      { key: "aa_owner", label: "Owner agent", format: "text" },
      { key: "aa_cron", label: "Cron", format: "text" },
      { key: "aa_timezone", label: "Timezone", format: "text" },
      { key: "aa_enabled", label: "Enabled", format: "checkbox" },
      { key: "aa_next_run", label: "Next run", format: "text" },
      { key: "aa_last_run", label: "Last run", format: "text" },
    ],
  },
];
