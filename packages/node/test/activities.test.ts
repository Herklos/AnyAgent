import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeActivities, splitReply } from "../src/index.js";
import { NodeStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OWNER = "owner-1";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "node-act-"));
  dirs.push(dir);
  const backend = new MemoryBackend();
  await initOrg(backend);
  const agent = await createAgent(backend, {
    handle: "chief",
    harness: "fake",
    allowedAuthors: [OWNER],
  });
  const store = new NodeStore(join(dir, "n.sqlite"));
  const acts = createNodeActivities({
    store,
    backendForOrg: () => backend,
    ownerIdsForOrg: () => [OWNER],
    workdirRoots: [dir, tmpdir()],
    stateDir: dir,
    maxMessageChars: 100,
  });
  return { backend, agent, store, acts, dir };
}

describe("T-WP6-01 resolveConfig", () => {
  it("valid, invalid, workdir outside roots", async () => {
    const { acts, agent, backend } = await setup();
    const ok = await acts.resolveConfig({ orgId: "o", spaceId: "s", agentId: agent.agentId });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.spec.handle).toBe("chief");
      expect(ok.ownerIds).toContain(OWNER);
    }

    await backend.objects.update(agent.agentId, { aa_handle: "BAD" });
    const inv = await acts.resolveConfig({ orgId: "o", spaceId: "s", agentId: agent.agentId });
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(inv.reason).toBe("invalid");

    await backend.objects.update(agent.agentId, {
      aa_handle: "chief",
      aa_workdir: "/not/allowed/path",
    });
    const wd = await acts.resolveConfig({ orgId: "o", spaceId: "s", agentId: agent.agentId });
    expect(wd.ok).toBe(false);
    if (!wd.ok) expect(wd.reason).toBe("workdir-outside-roots");
  });
});

describe("T-WP6-02 deliver", () => {
  it("reply, eyes to check, idempotent key, split long text, notice", async () => {
    const { acts, agent, backend } = await setup();
    const chatId = agent.chatId;
    const inbound = await backend.postAs(chatId, OWNER, { text: "hi" });
    await backend.chat.react(chatId, inbound.id, "👀", true);

    const long = `${"para1\n\n".repeat(5)}${"x".repeat(250)}`;
    expect(splitReply(long, 100).length).toBeGreaterThan(1);

    const r1 = await acts.deliver({
      orgId: "o",
      spaceId: "s",
      chatId,
      kind: "reply",
      text: long,
      key: "k-reply",
      replyTo: inbound.id,
      clearEyesMessageId: inbound.id,
    });
    const r2 = await acts.deliver({
      orgId: "o",
      spaceId: "s",
      chatId,
      kind: "reply",
      text: "again",
      key: "k-reply",
      replyTo: inbound.id,
    });
    expect(r2.messageId).toBe(r1.messageId);

    const history = await backend.chat.history(chatId, { limit: 50 });
    const replies = history.filter((m) => m.replyTo === inbound.id || m.id === r1.messageId);
    expect(replies.length).toBeGreaterThanOrEqual(1);

    const updated = await backend.chat.get(chatId, inbound.id);
    expect(updated?.reactions["👀"] ?? []).not.toContain(backend.me);
    expect((updated?.reactions["✅"] ?? []).includes(backend.me)).toBe(true);

    const noticeBefore = history.length;
    await acts.deliver({
      orgId: "o",
      spaceId: "s",
      chatId,
      kind: "notice",
      text: "notice only",
      key: "k-notice",
    });
    const after = await backend.chat.history(chatId, { limit: 50 });
    expect(after.length).toBeGreaterThan(noticeBefore);
    expect(after.some((m) => m.text === "notice only")).toBe(true);
  });
});

describe("T-WP6-03 markReceived", () => {
  it("failure does not throw", async () => {
    const { acts } = await setup();
    await expect(
      acts.markReceived({
        orgId: "o",
        spaceId: "s",
        chatId: "missing",
        messageId: "nope",
      }),
    ).resolves.toBeUndefined();
  });
});
