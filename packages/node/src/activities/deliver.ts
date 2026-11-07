import type { Backend } from "@anyagent/backend";
import type { DeliverRequest } from "@anyagent/workflows";
import type { NodeStore } from "../store.js";

export interface DeliverDeps {
  backendForOrg: (orgId: string) => Backend;
  store: NodeStore;
  maxMessageChars?: number;
}

/** Split on paragraph boundaries into chunks ≤ maxChars. */
export function splitReply(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = "";
  for (const p of paragraphs) {
    const next = buf ? `${buf}\n\n${p}` : p;
    if (next.length <= maxChars) {
      buf = next;
      continue;
    }
    if (buf) parts.push(buf);
    if (p.length <= maxChars) {
      buf = p;
    } else {
      // Hard-split oversized paragraph
      for (let i = 0; i < p.length; i += maxChars) {
        parts.push(p.slice(i, i + maxChars));
      }
      buf = "";
    }
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [text.slice(0, maxChars)];
}

export function createDeliver(deps: DeliverDeps) {
  const maxChars = deps.maxMessageChars ?? 8000;
  return async function deliver(i: DeliverRequest): Promise<{ messageId: string }> {
    const existing = deps.store.getOp(i.key);
    if (existing) return { messageId: existing };

    const backend = deps.backendForOrg(i.orgId);
    const chunks = i.kind === "notice" ? [i.text] : splitReply(i.text, maxChars);
    let firstId = "";
    let replyTo = i.replyTo;
    for (const chunk of chunks) {
      const posted = await backend.chat.post(i.chatId, {
        text: chunk,
        ...(replyTo ? { replyTo } : {}),
        ...(i.kind === "reply" ? { agent: { name: "anybot", done: true } } : {}),
      });
      if (!firstId) firstId = posted.id;
      replyTo = posted.id;
    }

    if (i.clearEyesMessageId) {
      try {
        await backend.chat.react(i.chatId, i.clearEyesMessageId, "👀", false);
        await backend.chat.react(i.chatId, i.clearEyesMessageId, "✅", true);
      } catch (err) {
        console.error(
          JSON.stringify({
            outcome: "deliver-react-failed",
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          }),
        );
      }
    }

    deps.store.putOp(i.key, firstId);
    return { messageId: firstId };
  };
}
