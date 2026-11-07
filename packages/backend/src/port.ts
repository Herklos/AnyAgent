/**
 * Copied from spikes/016-backend-port-any/port.ts.
 * Source commit: c194379 (spike 016 on main).
 * Licence: Apache-2.0 (same as anyagent).
 * Changes: ObjectRecord.body; objects.create body; chat.create; errors moved to errors.ts.
 */

import type { Conflict, NotFound, Unauthorized, Unavailable, Unsupported } from "./errors.js";

export type Capability =
  | "resume-cursor"
  | "removal-resume"
  | "field-versions"
  | "atomic-update"
  | "roles"
  | "agent-envelope";

export type Scalar = string | number | boolean;
export type FieldValue = Scalar | string[] | null;

/** Keys are the schema's own keys (`aa_status`), never a backend's storage ids. Relations are object ids. */
export interface ObjectRecord {
  id: string;
  type: string;
  name: string;
  fields: Record<string, FieldValue>;
  /** Opaque, per field. Equal tokens mean "not written since". */
  fieldVersions: Record<string, string>;
  authorId: string;
  modifiedById: string;
  createdAt: string;
  modifiedAt: string;
  /** Opaque position in the backend's change order; compare with `compareCursor`. */
  cursor: string;
  /**
   * Object markdown body. Filled by `org.get` when the object has one;
   * `org.list` never includes it. An agent's instructions are its body.
   */
  body?: string;
}

export interface AgentEnvelope {
  name: string;
  /** false: the run behind this message is still going. Every run ends with a done:true message. */
  done: boolean;
  debugLink?: string;
  outcome?: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  authorId: string;
  text: string;
  replyTo?: string;
  agent?: AgentEnvelope;
  /** Participant ids @-mentioned in the text (empty when the backend does not parse them). */
  mentions: string[];
  /** Optional control payload (stop/close); backends without control leave this undefined. */
  control?: { kind: string; hard?: boolean };
  createdAt: string;
  edited: boolean;
  /** Emoji → participant ids. Prefer a `?reactions=full` read when deciding on a reaction. */
  reactions: Record<string, string[]>;
  cursor: string;
}

export interface PostInput {
  text?: string;
  replyTo?: string;
  agent?: AgentEnvelope;
  control?: { kind: string; hard?: boolean };
}

export type Role = "owner" | "admin" | "writer" | "reader" | "guest";

export type WatchSpec =
  | { kind: "chat"; chatId: string }
  | { kind: "objects"; type: string; where?: Record<string, Scalar> };

export type WatchOp = "added" | "updated" | "removed" | "upsert";

/**
 * `ready`: everything before it was catch-up or the initial state, everything after it is live.
 * `upsert` is catch-up: the current state of something that changed while the watcher was down.
 */
export type WatchEvent =
  | { kind: "ready" }
  | { kind: "chat"; op: WatchOp; id: string; message?: ChatMessage; cursor?: string }
  | { kind: "object"; op: WatchOp; id: string; object?: ObjectRecord; cursor?: string };

export type BackendError = Unauthorized | Unavailable | NotFound | Conflict | Unsupported;

export interface Backend {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;

  identity: {
    /** The participant this connection writes as (message authors are participants). */
    self(): Promise<{ id: string }>;
    roleOf(participantId: string): Promise<Role | undefined>;
  };

  org: {
    list(type: string, where?: Record<string, Scalar>): Promise<ObjectRecord[]>;
    get(id: string): Promise<ObjectRecord | undefined>;
  };

  objects: {
    create(
      type: string,
      input: { name: string; fields?: Record<string, FieldValue>; body?: string },
    ): Promise<ObjectRecord>;
    /** `expect` maps field keys to the `fieldVersions` the caller read. Stale -> Conflict. */
    update(
      id: string,
      patch: Record<string, FieldValue>,
      opts?: { expect?: Record<string, string> },
    ): Promise<ObjectRecord>;
  };

  chat: {
    /** The space's general chat. */
    general(): Promise<string>;
    /** Create a new chat; returns its id (heart: POST /v2/spaces/{s}/chats). */
    create(input: { name: string }): Promise<string>;
    post(chatId: string, input: PostInput): Promise<ChatMessage>;
    edit(chatId: string, messageId: string, text: string): Promise<ChatMessage>;
    /** Idempotent: `on` states the wanted end state. */
    react(chatId: string, messageId: string, emoji: string, on: boolean): Promise<ChatMessage>;
    remove(chatId: string, messageId: string): Promise<void>;
    get(chatId: string, messageId: string): Promise<ChatMessage | undefined>;
    /** The newest `limit` messages, oldest first. */
    history(chatId: string, opts?: { limit?: number }): Promise<ChatMessage[]>;
  };

  events: {
    /**
     * Ends when `signal` aborts. With `after`, replays what changed since that
     * cursor, then `ready`, then live. Reconnects by itself from the last event
     * id; on a dropped socket the consumer must not see duplicates.
     */
    watch(
      spec: WatchSpec,
      opts?: { after?: string; signal?: AbortSignal },
    ): AsyncIterable<WatchEvent>;
  };
}

export type FieldFormat = "text" | "number" | "checkbox" | "select" | "multi_select" | "objects";

export interface FieldDef {
  key: string;
  label: string;
  format: FieldFormat;
  options?: string[];
}

export interface TypeDef {
  key: string;
  label: string;
  fields: FieldDef[];
  /** Every object of this type is its own chat (an aa_group is a group *and* its conversation). */
  chat?: boolean;
}

export interface SchemaAdmin {
  /** Idempotent: create what is missing, never duplicate, never remove. */
  ensureSchema(defs: TypeDef[]): Promise<void>;
}

/**
 * Compare two cursors when a backend promises they are orderable integers.
 * Anytype resume ids are opaque — adapters must not call this on heart cursors;
 * use history order / message ids instead. MemoryBackend and the reference
 * conformance backends use integer sequences.
 */
export function compareCursor(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
