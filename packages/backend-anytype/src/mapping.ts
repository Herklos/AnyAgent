/**
 * Map heart (or mock-heart) JSON into port records.
 * Live field names remain unverified until spike 002; mock uses these shapes.
 */
import type { ChatMessage, FieldValue, ObjectRecord, Role } from "@anyagent/backend";

export interface HeartObject {
  id: string;
  type: string;
  name: string;
  fields?: Record<string, FieldValue>;
  field_versions?: Record<string, string>;
  author_id?: string;
  modified_by_id?: string;
  created_at?: string;
  modified_at?: string;
  cursor?: string;
  body?: string;
}

export interface HeartMessage {
  id: string;
  chat_id: string;
  author_id: string;
  text?: string;
  reply_to?: string;
  agent?: ChatMessage["agent"];
  mentions?: string[];
  control?: ChatMessage["control"];
  created_at?: string;
  edited?: boolean;
  reactions?: Record<string, string[]>;
  cursor?: string;
}

export function mapObject(raw: HeartObject, includeBody: boolean): ObjectRecord {
  const rec: ObjectRecord = {
    id: raw.id,
    type: raw.type,
    name: raw.name,
    fields: { ...(raw.fields ?? {}) },
    fieldVersions: { ...(raw.field_versions ?? {}) },
    authorId: raw.author_id ?? "",
    modifiedById: raw.modified_by_id ?? raw.author_id ?? "",
    createdAt: raw.created_at ?? "",
    modifiedAt: raw.modified_at ?? "",
    cursor: raw.cursor ?? "0",
  };
  if (includeBody && raw.body !== undefined) rec.body = raw.body;
  return rec;
}

export function mapMessage(raw: HeartMessage): ChatMessage {
  return {
    id: raw.id,
    chatId: raw.chat_id,
    authorId: raw.author_id,
    text: raw.text ?? "",
    mentions: raw.mentions ?? [],
    createdAt: raw.created_at ?? "",
    edited: raw.edited ?? false,
    reactions: raw.reactions ?? {},
    cursor: raw.cursor ?? "0",
    ...(raw.reply_to ? { replyTo: raw.reply_to } : {}),
    ...(raw.agent ? { agent: raw.agent } : {}),
    ...(raw.control ? { control: raw.control } : {}),
  };
}

export function mapRole(raw: string | undefined): Role | undefined {
  if (
    raw === "owner" ||
    raw === "admin" ||
    raw === "writer" ||
    raw === "reader" ||
    raw === "guest"
  ) {
    return raw;
  }
  return undefined;
}
