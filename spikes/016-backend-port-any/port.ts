// The backend port (ADR 0017): everything anybot needs from the system that holds the org.
// Five areas: identity, org (read), objects (write), chat, events. Plus SchemaAdmin for bootstrap (spike 009).
// Code asks for a capability, never for a backend's name.

export type Capability =
  | "resume-cursor" //   watch({after}) catches up on every change made while the watcher was down
  | "removal-resume" //  ...including removals
  | "field-versions" //  each field of an object carries its own version token
  | "atomic-update" //   update({expect}) is a server-side compare-and-set
  | "roles" //           the backend knows each participant's role in the space
  | "agent-envelope"; // chat messages can be marked as written by an agent, with a liveness flag

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
  /** Participant ids the backend derived from the text and the reply target. */
  mentions: string[];
  /** A signal to the agent serving the chat ("break" stops the run in flight); not content. */
  control?: { kind: string; hard?: boolean };
  createdAt: string;
  edited: boolean;
  /** emoji -> participant ids. An emoji nobody holds is absent. */
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
 * `upsert` is catch-up: the current state of something that changed while the watcher was down (it may have been
 * added, edited or reacted to, and the backend does not say which). Consumers deduplicate on their own keys.
 */
export type WatchEvent =
  | { kind: "ready" }
  | { kind: "chat"; op: WatchOp; id: string; message?: ChatMessage; cursor?: string }
  | { kind: "object"; op: WatchOp; id: string; object?: ObjectRecord; cursor?: string };

export class ConflictError extends Error {
  readonly objectId: string;
  readonly fields: string[];
  constructor(objectId: string, fields: string[]) {
    super(`stale write on ${objectId}: ${fields.join(", ")}`);
    this.name = "ConflictError";
    this.objectId = objectId;
    this.fields = fields;
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`not found: ${what}`);
    this.name = "NotFoundError";
  }
}

export interface Backend {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;

  identity: {
    /** The participant this connection writes as. */
    self(): Promise<{ id: string }>;
    roleOf(participantId: string): Promise<Role | undefined>;
  };

  org: {
    list(type: string, where?: Record<string, Scalar>): Promise<ObjectRecord[]>;
    get(id: string): Promise<ObjectRecord | undefined>;
  };

  objects: {
    create(type: string, input: { name: string; fields?: Record<string, FieldValue> }): Promise<ObjectRecord>;
    /** `expect` maps field keys to the `fieldVersions` the caller read. Stale -> ConflictError. */
    update(id: string, patch: Record<string, FieldValue>, opts?: { expect?: Record<string, string> }): Promise<ObjectRecord>;
  };

  chat: {
    /** The space's general chat. */
    general(): Promise<string>;
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
     * Ends when `signal` aborts. With `after`, first replays what changed since that cursor (as `upsert`, and
     * `removed` when the backend can say so), then `ready`, then live events. Without it: the current state of an
     * `objects` watch as `upsert`, or nothing for a chat, then `ready`, then live events.
     */
    watch(spec: WatchSpec, opts?: { after?: string; signal?: AbortSignal }): AsyncIterable<WatchEvent>;
  };
}

// ---- Schema (data, not code: the aa_* keys of docs/specs/schema.md) ----

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

/** Cursors are opaque, but a backend may promise they are comparable. Both backends here use integers. */
export function compareCursor(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
