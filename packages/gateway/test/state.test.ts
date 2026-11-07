import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayState } from "../src/state.js";

const dirs: string[] = [];

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-state-"));
  dirs.push(dir);
  return join(dir, "gateway.sqlite");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("T-WP5-02 state store", () => {
  it("commit and mark-delivered are atomic", () => {
    const state = new GatewayState(tmpDb());
    state.commitAndMarkDelivered("space-a", "chat:c1", "cursor-9", "chat:c1:m1");
    expect(state.getCursor("space-a", "chat:c1")).toBe("cursor-9");
    expect(state.isDelivered("space-a", "chat:c1:m1")).toBe(true);
    state.close();
  });

  it("pruning keeps recent keys and drops old ones", () => {
    const state = new GatewayState(tmpDb());
    state.markDelivered("space-a", "old-key");
    // Backdate delivered_at via raw SQL on a second connection path: use prune with now far ahead.
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    const pruned = state.pruneDelivered(Date.now() + eightDays);
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(state.isDelivered("space-a", "old-key")).toBe(false);

    state.markDelivered("space-a", "fresh-key");
    expect(state.pruneDelivered(Date.now())).toBe(0);
    expect(state.isDelivered("space-a", "fresh-key")).toBe(true);
    state.close();
  });

  it("restart reads the same cursor", () => {
    const path = tmpDb();
    const a = new GatewayState(path);
    a.commit("space-b", "chat:x", "42");
    a.markDelivered("space-b", "k1");
    a.close();

    const b = new GatewayState(path);
    expect(b.getCursor("space-b", "chat:x")).toBe("42");
    expect(b.isDelivered("space-b", "k1")).toBe(true);
    b.close();
  });
});
