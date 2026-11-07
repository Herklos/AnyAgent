import type { RotationHint } from "@anyagent/workflows";
import { describe, expect, it } from "vitest";
import { maybeRotate, type RotationClient } from "../src/rotation.js";

class FakeRotation implements RotationClient {
  hint: RotationHint = {
    continueAsNewSuggested: false,
    historyLength: 0,
    idle: true,
    accepted: 0,
  };
  closed: string[] = [];

  async queryRotation(): Promise<RotationHint> {
    return this.hint;
  }
  async signalClose(workflowId: string): Promise<void> {
    this.closed.push(workflowId);
  }
}

describe("rotation", () => {
  it("closes idle workflow at threshold", async () => {
    const client = new FakeRotation();
    client.hint = { ...client.hint, idle: true, accepted: 1500 };
    const ok = await maybeRotate({
      client,
      orgId: "o",
      spaceId: "s",
      agentId: "a",
    });
    expect(ok).toBe(true);
    expect(client.closed).toEqual(["agent:s:a"]);
  });

  it("never closes a busy workflow", async () => {
    const client = new FakeRotation();
    client.hint = { ...client.hint, idle: false, accepted: 2000 };
    const ok = await maybeRotate({
      client,
      orgId: "o",
      spaceId: "s",
      agentId: "a",
      rotateAfterAccepted: 10,
    });
    expect(ok).toBe(false);
    expect(client.closed).toEqual([]);
  });

  it("respects lowered threshold", async () => {
    const client = new FakeRotation();
    client.hint = { ...client.hint, idle: true, accepted: 3 };
    const ok = await maybeRotate({
      client,
      orgId: "o",
      spaceId: "s",
      agentId: "a",
      rotateAfterAccepted: 3,
    });
    expect(ok).toBe(true);
  });
});
