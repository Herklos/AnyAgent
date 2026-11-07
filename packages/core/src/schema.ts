import type { TypeDef } from "@anyagent/backend";

/** v0 schema as data in the port's TypeDef format. */
export const V0_SCHEMA_VERSION = "0.1.0";

export const V0_SCHEMA: TypeDef[] = [
  {
    key: "aa_settings",
    label: "Settings",
    fields: [{ key: "aa_schema_version", label: "Schema version", format: "text" }],
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
        options: ["read_only", "full"],
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
];
