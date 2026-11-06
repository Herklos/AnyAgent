# ADR 0008: Approvals are objects, decided by a reaction or an edit from an approver's identity

- Status: accepted (owner, 2026-11-06)
- Date: 2026-11-06

## Context

Agents with shell access must pause before risky actions. Michel's connector ADR 0028 refuses approvals by chat text,
because Slack-style text can be forged. Anytype differs: each change is signed by its author's account, and a message's
`author_id` and a reaction's participant id identify an account.

Verified at anytype-heart@09bd4b5: the stream's `reactions_updated` event carries counts only; `ReactedBy` "is
populated only when the caller asked for them; the stream route has no such switch today, so it is always absent
there" (`core/api/v2/model/chat_event.go`). The messages read takes `?reactions=full`, which "adds the participant ids
behind each count" (`core/api/v2/handler/chat.go`, line 146).

## Decision

1. Approval modes per agent (from Michel): `read_only`, `ask`, `auto` (a judge model decides low-risk actions), `full`.
   The pure decision function is Michel's `preDecision` ([research/michel-reuse.md](../research/michel-reuse.md)).
2. When a person must decide, the node creates an **`aa_approval`** object (requester, task, action, risk, summary,
   `expires_at`) and posts a chat message linking it; the workflow waits.
3. A decision counts when either:
   - a ✅ or ❌ reaction appears on that message, and a re-read with `?reactions=full` shows a participant id in the
     space's `approvers` list; or
   - the object's `status` is set to `approved` / `denied` by an approver (author verification: [SPIKES.md](../SPIKES.md) 005).
4. The event gateway ([ADR 0011](0011-event-gateway.md)) does the re-read and the approver check, then signals the
   workflow; a node activity records `aa_decided_by` and `aa_decided_at`. Expiry denies.
5. Approvers are a list of participant ids on the space's `aa_settings` object, editable only by the space owner.

## Consequences

- Decisions are authenticated by Anytype's signatures, not by text.
- A reaction from a non-approver is ignored (and may get a notice).
- One extra read per reaction on an approval message.

## Extension points

- Decision channels are a list (reaction, object edit); a push notification channel can be added.

## Not generalised

- No multi-approver quorum in v0.
