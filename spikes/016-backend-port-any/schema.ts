// The slice of docs/specs/schema.md this spike needs: prompts, agents, groups (each its own chat) and tasks.
import type { TypeDef } from "./port.ts";

export const SCHEMA: TypeDef[] = [
  {
    key: "aa_prompt",
    label: "Prompt",
    fields: [
      { key: "aa_kind", label: "Kind", format: "select", options: ["system", "rule", "approval_criteria"] },
      { key: "aa_text", label: "Text", format: "text" },
    ],
  },
  {
    key: "aa_agent",
    label: "Agent",
    fields: [
      { key: "aa_handle", label: "Handle", format: "text" },
      { key: "aa_harness", label: "Harness", format: "select", options: ["claude-code", "codex", "opencode", "openai"] },
      { key: "aa_approval_mode", label: "Approval mode", format: "select", options: ["read_only", "ask", "auto", "full"] },
      { key: "aa_prompt", label: "Prompt", format: "objects" },
      { key: "aa_reports_to", label: "Reports to", format: "objects" },
    ],
  },
  {
    key: "aa_group",
    label: "Group",
    chat: true,
    fields: [
      { key: "aa_handle", label: "Handle", format: "text" },
      { key: "aa_members", label: "Members", format: "objects" },
    ],
  },
  {
    key: "aa_task",
    label: "Task",
    fields: [
      { key: "aa_status", label: "Status", format: "select", options: ["todo", "in_progress", "review", "done"] },
      { key: "aa_attempts", label: "Attempts", format: "number" },
      { key: "aa_lead", label: "Lead", format: "objects" },
      { key: "aa_assignee", label: "Assignee", format: "objects" },
      { key: "aa_group", label: "Group", format: "objects" },
    ],
  },
];
