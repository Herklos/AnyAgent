# Anytype schema v0 (draft)

Status: draft for [ADR 0009](../adr/0009-new-minimal-versioned-schema.md). Type and property keys are prefixed `aa_`
(open question Q1); display names are plain. "Writer" says who may change a property; the node enforces it on egress
([ADR 0006](../adr/0006-coordination-hierarchy-with-opt-in-claims.md)). "Person" means a space member who is not a node.

Formats are Anytype property formats: `text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `objects`, `url`.

## Overview

```
aa_settings (1 per space) ── approvers, schema_version, rules → aa_prompt
aa_node ◄── node ── aa_agent ── prompt ──► aa_prompt
                      │  ▲ members/lead
                      ▼  │
                   aa_group ── chat_id ──► Anytype chat
                      ▲
aa_task ── group, lead, assignee, reviewer, origin_message
aa_schedule ── owner ──► aa_agent          aa_trigger ── owner ──► aa_agent
aa_approval ── requester ──► aa_agent, task ──► aa_task
```

## aa_settings

One per space. Created by `anyagent bootstrap`.

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_schema_version` | text | bootstrap/migrate | Semver of this schema, e.g. `0.1.0` |
| `aa_approvers` | text | space owner | Comma-separated participant ids allowed to decide approvals ([ADR 0008](../adr/0008-approvals-objects-and-reactions.md)) |
| `aa_rules` | objects → `aa_prompt` | person | Rules every agent follows (the Shared Rules equivalent) |
| `aa_temporal_namespace` | text | person | Informational; the real address is node config |

## aa_node

A machine that runs agents. Body: free notes.

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_handle` | text | person | Stable lowercase id, e.g. `mac-studio`. Task queue = `node:<handle>` |
| `aa_participant_id` | text | node (at registration) | The node's Anytype account in this space ([ADR 0005](../adr/0005-identity-one-account-per-node-first.md)) |
| `aa_harnesses` | multi_select | node | Harnesses detected on the machine (`claude-code`, `codex`, `opencode`, `openai`, …) |
| `aa_last_seen` | date | node | Heartbeat, written at most every 5 minutes |
| `aa_lifecycle` | select | person | `live` \| `paused` \| `retired` |

## aa_agent

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_handle` | text | person | Mention handle, unique in the space, e.g. `chief` |
| `aa_node` | objects → `aa_node` | person | Home node; turns run there |
| `aa_harness` | select | person | Registry id: `claude-code`, `codex`, `opencode`, `openai`, `acp`, … |
| `aa_model` | text | person | Model name passed to the harness; empty = harness default |
| `aa_effort` | select | person | `low` \| `medium` \| `high` (when the harness supports it) |
| `aa_prompt` | objects → `aa_prompt` | person | System instructions |
| `aa_reports_to` | objects → `aa_agent` | person | Hierarchy; escalation path |
| `aa_approval_mode` | select | person | `read_only` \| `ask` \| `auto` \| `full` |
| `aa_workdir` | text | person | Working directory on the home node |
| `aa_session_scope` | select | person | `agent` (one long session) \| `task` (fresh session per task, Michel ADR 0022) |
| `aa_lifecycle` | select | person | `draft` \| `live` \| `paused` \| `archived`. Only `live` agents get a workflow |
| `aa_status` | select | node | `idle` \| `working` \| `waiting_approval` \| `offline` (projection, for people) |

Body: a short role description (shown to the group's lead and router).

## aa_prompt

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_prompt_kind` | select | person | `system` \| `rules` \| `library` |
| `aa_version` | text | person | Bumped on meaningful change; recorded on each turn |

Body: the prompt text, read as markdown at each turn boundary.

## aa_group

A group of agents and people with one Anytype chat.

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_chat_id` | text | bootstrap / person | Id of the Anytype chat object for this group |
| `aa_members` | objects → `aa_agent` | person | Agents that listen in this chat |
| `aa_lead` | objects → `aa_agent` | person | Answers unaddressed messages when `routing = lead`; assigns tasks |
| `aa_routing` | select | person | `lead` (default) \| `everyone` \| `none` |
| `aa_claims` | checkbox | person | Allow members to claim Ready tasks ([ADR 0006](../adr/0006-coordination-hierarchy-with-opt-in-claims.md)) |
| `aa_allowed_authors` | text | person | Participant ids whose messages may wake agents; empty = all space members |
| `aa_max_hops` | number | person | Agent-to-agent replies allowed since the last human message (default 4) |
| `aa_purpose` | text | person | One line, injected into turns as context |

## aa_task

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_status` | select | see below | `backlog` \| `ready` \| `in_progress` \| `review` \| `blocked` \| `done` \| `cancelled` |
| `aa_group` | objects → `aa_group` | creator | Where it is discussed |
| `aa_lead` | objects → `aa_agent` | person / creator | The only writer of `assignee`, `done`, `cancelled` |
| `aa_assignee` | objects → `aa_agent` | lead | |
| `aa_reviewer` | objects → `aa_agent` | lead | Optional; must differ from the assignee |
| `aa_requested_by` | text | creator | Participant id or agent handle |
| `aa_origin_message` | text | creator | `chatId/messageId` of the message that started it |
| `aa_criterion` | text | lead | What must be true when done |
| `aa_result` | text | assignee | Short result; details in the body |
| `aa_due` | date | lead | Optional |
| `aa_op_key` | text | node | Idempotency key of the last write |

Status writers: assignee → `in_progress`, `review`, `blocked`; lead (or reviewer for `review` → `done`) → `ready`,
`done`, `cancelled`.

## aa_schedule

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_owner` | objects → `aa_agent` | person / agent | The agent woken |
| `aa_cron` | text | person / agent | 5-field cron |
| `aa_timezone` | text | person / agent | IANA zone, e.g. `Europe/Paris` |
| `aa_enabled` | checkbox | person | Disabled = Temporal Schedule paused |
| `aa_deliver_to` | objects → `aa_group` | person / agent | Where the result is posted (default: the owner's first group) |
| `aa_next_run` | date | node | Projection from Temporal (Calendar view) |
| `aa_last_run` | date | node | Projection from Temporal |

Body: the self-contained prompt for the run.

## aa_trigger

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_owner` | objects → `aa_agent` | person | The agent woken |
| `aa_trigger_kind` | select | person | `webhook` \| `object_change` \| `chat_pattern` (registry; new kinds added here) |
| `aa_match` | text | person | Kind-specific: a JSON search body, a regex, or a webhook path suffix |
| `aa_secret_ref` | text | person | Name of a secret in the gateway's config (never the secret) ([ADR 0011](../adr/0011-event-gateway.md)) |
| `aa_enabled` | checkbox | person | |
| `aa_last_fired` | date | node | |

Body: the prompt template; `{{payload}}` is replaced with the (truncated) event.

## aa_approval

| Key | Format | Writer | Notes |
| --- | --- | --- | --- |
| `aa_requester` | objects → `aa_agent` | node | |
| `aa_task` | objects → `aa_task` | node | Optional |
| `aa_action` | text | node | What will run (command, tool and arguments, summarised) |
| `aa_risk` | select | node | `low` \| `medium` \| `high` |
| `aa_status` | select | approver / node | `pending` \| `approved` \| `denied` \| `expired` |
| `aa_message` | text | node | `chatId/messageId` of the chat message to react to |
| `aa_expires_at` | date | node | |
| `aa_decided_by` | text | node | Participant id verified at decision time |
| `aa_decided_at` | date | node | |

## Queries created by bootstrap

`Agents` (all `aa_agent`), `Tasks – Board` (Kanban on `aa_status`), `Approvals – Pending`, `Schedules – Calendar`
(Calendar on `aa_next_run`), `Nodes`.

## Not in v0

Memory, skills, logs and suggestions (all present in the `anytype-agents` skill) come later, as additive types.
