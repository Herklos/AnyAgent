import type { Backend } from "@anyagent/backend";

export interface MarkReceivedDeps {
  backendForOrg: (orgId: string) => Backend;
}

/** Best-effort 👀 on the inbound message; failures are logged and ignored. */
export function createMarkReceived(deps: MarkReceivedDeps) {
  return async function markReceived(i: {
    orgId: string;
    spaceId: string;
    chatId: string;
    messageId: string;
  }): Promise<void> {
    void i.spaceId;
    try {
      await deps.backendForOrg(i.orgId).chat.react(i.chatId, i.messageId, "👀", true);
    } catch (err) {
      console.error(
        JSON.stringify({
          outcome: "mark-received-failed",
          org: i.orgId,
          chat: i.chatId,
          message: i.messageId,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        }),
      );
    }
  };
}
