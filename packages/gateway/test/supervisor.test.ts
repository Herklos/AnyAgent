import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayState } from "../src/state.js";
import { startGateway, startOrgSupervisor } from "../src/supervisor.js";
import { FakeDeliveryClient } from "./support/fake-delivery.js";
import { FaultyBackend } from "./support/faulty-backend.js";
import { waitFor } from "./support/wait.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newState(): GatewayState {
  const dir = mkdtempSync(join(tmpdir(), "gw-sup-"));
  dirs.push(dir);
  return new GatewayState(join(dir, "gateway.sqlite"));
}

const OWNER = "owner-1";

/** Tiny real delay so Unavailable backoff cannot busy-loop the event loop. */
const testSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 30)));

async function setupOrg(handle: string) {
  const backend = new MemoryBackend();
  await initOrg(backend);
  const agent = await createAgent(backend, {
    handle,
    harness: "claude-code",
    allowedAuthors: [OWNER],
  });
  return { backend, agent };
}

describe("T-WP5-08 two orgs isolation", () => {
  it("org A Unavailable does not block org B; A catches up when restored", async () => {
    const state = newState();
    const a = await setupOrg("agent-a");
    const b = await setupOrg("agent-b");
    const faultyA = new FaultyBackend(a.backend);
    const delivery = new FakeDeliveryClient();

    const gw = startGateway({
      orgs: [
        {
          orgId: "org-a",
          spaceId: "space-a",
          backend: faultyA,
          ownerIds: [OWNER],
          nodeQueue: "nq",
        },
        {
          orgId: "org-b",
          spaceId: "space-b",
          backend: b.backend,
          ownerIds: [OWNER],
          nodeQueue: "nq",
        },
      ],
      state,
      delivery,
      sleep: testSleep,
      maxBackoffMs: 50,
      initialBackoffMs: 20,
    });

    await waitFor(() => (gw.supervisors.get("org-b")?.agents.size ?? 0) > 0, 5_000);
    await waitFor(() => (gw.supervisors.get("org-a")?.agents.size ?? 0) > 0, 5_000);

    // Establish a cursor on A so resume can catch up after Unavailable.
    await a.backend.postAs(a.agent.chatId, OWNER, { text: "from-a-seed" });
    await waitFor(() => delivery.delivered.some((d) => d.target.orgId === "org-a"), 8_000);
    const aBefore = delivery.delivered.filter((d) => d.target.orgId === "org-a").length;

    faultyA.fault = "unavailable";
    await a.backend.postAs(a.agent.chatId, OWNER, { text: "from-a-missed" });
    await b.backend.postAs(b.agent.chatId, OWNER, { text: "from-b" });
    await waitFor(() => delivery.delivered.some((d) => d.target.orgId === "org-b"), 8_000);

    faultyA.fault = "none";
    await a.backend.postAs(a.agent.chatId, OWNER, { text: "from-a-after" });
    await waitFor(
      () => delivery.delivered.filter((d) => d.target.orgId === "org-a").length > aBefore,
      15_000,
    );

    expect(delivery.delivered.some((d) => d.target.orgId === "org-b")).toBe(true);
    await gw.stop();
    state.close();
  }, 30_000);
});

describe("T-WP5-09 Unauthorized stops only that org", () => {
  it("stops org A supervisor with a message naming the org; org B continues", async () => {
    const state = newState();
    const a = await setupOrg("agent-ua");
    const b = await setupOrg("agent-ub");
    const faultyA = new FaultyBackend(a.backend);
    const delivery = new FakeDeliveryClient();

    // Inject Unauthorized before supervisor starts identity.self
    faultyA.fault = "unauthorized";
    const gw = startGateway({
      orgs: [
        {
          orgId: "org-bad",
          spaceId: "space-bad",
          backend: faultyA,
          ownerIds: [OWNER],
          nodeQueue: "nq",
        },
        {
          orgId: "org-ok",
          spaceId: "space-ok",
          backend: b.backend,
          ownerIds: [OWNER],
          nodeQueue: "nq",
        },
      ],
      state,
      delivery,
      sleep: testSleep,
      maxBackoffMs: 50,
    });

    await waitFor(() => gw.supervisors.get("org-bad")?.stopped === true, 5_000);
    expect(gw.supervisors.get("org-bad")?.stopReason).toMatch(/org-bad/);
    expect(gw.supervisors.get("org-bad")?.stopReason).toMatch(/Unauthorized/i);

    await waitFor(() => (gw.supervisors.get("org-ok")?.agents.size ?? 0) > 0, 5_000);
    await b.backend.postAs(b.agent.chatId, OWNER, { text: "still-works" });
    await waitFor(() => delivery.delivered.some((d) => d.target.orgId === "org-ok"), 8_000);

    await gw.stop();
    state.close();
  }, 20_000);
});

describe("T-WP5-11 resume", () => {
  it("delivers exactly the missed messages after restart, none before the cursor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-resume-"));
    dirs.push(dir);
    const dbPath = join(dir, "gateway.sqlite");
    const { backend, agent } = await setupOrg("resume-bot");
    const delivery1 = new FakeDeliveryClient();
    const state1 = new GatewayState(dbPath);

    const s1 = startOrgSupervisor({
      orgId: "org",
      spaceId: "space",
      backend,
      state: state1,
      delivery: delivery1,
      nodeQueue: "nq",
      ownerIds: [OWNER],
      sleep: testSleep,
    });
    await waitFor(() => s1.agents.has(agent.agentId), 5_000);

    const m1 = await backend.postAs(agent.chatId, OWNER, { text: "before-stop-1" });
    const m2 = await backend.postAs(agent.chatId, OWNER, { text: "before-stop-2" });
    await waitFor(() => delivery1.delivered.length >= 2, 8_000);
    await s1.stop();
    state1.close();

    const m3 = await backend.postAs(agent.chatId, OWNER, { text: "while-down" });
    const m4 = await backend.postAs(agent.chatId, OWNER, { text: "while-down-2" });

    const delivery2 = new FakeDeliveryClient();
    const state2 = new GatewayState(dbPath);
    const s2 = startOrgSupervisor({
      orgId: "org",
      spaceId: "space",
      backend,
      state: state2,
      delivery: delivery2,
      nodeQueue: "nq",
      ownerIds: [OWNER],
      sleep: testSleep,
    });
    await waitFor(() => delivery2.delivered.length >= 2, 10_000);

    const keys = delivery2.delivered.map((d) => d.input.key);
    expect(keys).toContain(`chat:${agent.chatId}:${m3.id}`);
    expect(keys).toContain(`chat:${agent.chatId}:${m4.id}`);
    expect(keys).not.toContain(`chat:${agent.chatId}:${m1.id}`);
    expect(keys).not.toContain(`chat:${agent.chatId}:${m2.id}`);

    await s2.stop();
    state2.close();
  }, 30_000);
});
