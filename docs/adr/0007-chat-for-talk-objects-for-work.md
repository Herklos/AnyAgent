# ADR 0007: Chat for talk, objects for work

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

Agents must signal and update each other across machines. Options: everything as chat messages (chat becomes the
database), everything as objects (agent talk invisible in chat), or both with a split. The existing org already keeps
"durable state in Anytype; item-scoped dialogue often lives in page/card comments" (`anytype-agents/SKILL.md`).

## Decision

1. **Chat** carries conversation, @mentions, notices and receipts (👀 ⏳ ✅). It is what people read.
2. **Objects** carry anything that must survive, be queried or change state: `aa_task`, `aa_approval`, results,
   schedules. A durable request is an object **linked from** a chat message (the message links the object; the object
   records `origin_message` and `group`).
3. An agent hands work to another by creating or updating an `aa_task` and mentioning the assignee in the group chat.
   The mention wakes the agent quickly; the task is the contract.
4. Object discussions (`POST /v2/spaces/{s}/objects/{id}/discussion`) are available for item-scoped dialogue; v0 does
   not route them (open question Q5).

## Consequences

- People can follow everything in chat and query everything in object views (Queries, Kanban on `status`).
- Ingress listens to both chat streams and the object search stream.

## Extension points

- New durable request kinds are new types with the same `origin_message` / `group` links.

## Not generalised

- No structured payloads inside chat text (no fenced JSON protocol).
