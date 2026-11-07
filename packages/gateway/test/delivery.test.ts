import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatInput } from "@anyagent/workflows";
import { afterEach, describe, expect, it } from "vitest";
import { deliverAndCommit } from "../src/delivery.js";
import { GatewayState } from "../src/state.js";
import { AcceptOnlyClient, FakeDeliveryClient } from "./support/fake-delivery.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function state(): GatewayState {
  const dir = mkdtempSync(join(tmpdir(), "gw-del-"));
  dirs.push(dir);
  return new GatewayState(join(dir, "gateway.sqlite"));
}

const target = {
  orgId: "org",
  spaceId: "space",
  agentId: "agent",
  nodeQueue: "node-q",
};

function input(id: string): ChatInput {
  return {
    key: `chat:c1:${id}`,
    chatId: "c1",
    messageId: id,
    authorId: "owner",
    text: id,
  };
}

describe("T-WP5-03 delivery commit rules (fake)", () => {
  it("does not commit cursor when delivery fails", async () => {
    const st = state();
    const client = new FakeDeliveryClient();
    client.failNext = 1;
    await expect(
      deliverAndCommit({
        state: st,
        client,
        target,
        input: input("m1"),
        cursor: "10",
        chatId: "c1",
      }),
    ).rejects.toThrow(/delivery failed/);
    expect(st.getCursor("space", "chat:c1")).toBeUndefined();
    expect(st.isDelivered("space", "chat:c1:m1")).toBe(false);
    st.close();
  });

  it("commits after acceptance", async () => {
    const st = state();
    const client = new FakeDeliveryClient();
    await deliverAndCommit({
      state: st,
      client,
      target,
      input: input("m2"),
      cursor: "20",
      chatId: "c1",
    });
    expect(st.getCursor("space", "chat:c1")).toBe("20");
    expect(st.isDelivered("space", "chat:c1:m2")).toBe(true);
    st.close();
  });

  it("mid-batch failure leaves cursor at last accepted", async () => {
    const st = state();
    const client = new FakeDeliveryClient();
    await deliverAndCommit({
      state: st,
      client,
      target,
      input: input("a"),
      cursor: "1",
      chatId: "c1",
    });
    client.failAfter = client.acceptCalls;
    await expect(
      deliverAndCommit({
        state: st,
        client,
        target,
        input: input("b"),
        cursor: "2",
        chatId: "c1",
      }),
    ).rejects.toThrow(/mid-batch/);
    expect(st.getCursor("space", "chat:c1")).toBe("1");
    expect(st.isDelivered("space", "chat:c1:a")).toBe(true);
    expect(st.isDelivered("space", "chat:c1:b")).toBe(false);
    st.close();
  });
});

describe("T-WP5-04 crash between acceptance and commit", () => {
  it("redelivers with same update id after restart; second accept succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-crash-"));
    dirs.push(dir);
    const path = join(dir, "gateway.sqlite");
    const st1 = new GatewayState(path);
    const accept = new AcceptOnlyClient();
    // Simulate: accepted but crash before commit (do not call deliverAndCommit's commit path).
    await accept.deliverChat(target, input("m9"));
    expect(st1.isDelivered("space", "chat:c1:m9")).toBe(false);
    st1.close();

    const st2 = new GatewayState(path);
    const client = new FakeDeliveryClient();
    // Pipeline would not drop (not marked delivered); deliver again with same key.
    await deliverAndCommit({
      state: st2,
      client,
      target,
      input: input("m9"),
      cursor: "99",
      chatId: "c1",
    });
    expect(client.delivered[0]?.input.key).toBe("chat:c1:m9");
    expect(st2.isDelivered("space", "chat:c1:m9")).toBe(true);
    expect(st2.getCursor("space", "chat:c1")).toBe("99");
    st2.close();
  });
});
