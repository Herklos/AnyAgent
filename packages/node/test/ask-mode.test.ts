/**
 * T-V1-WP2-11 mode-unsupported for headless; T-V1-WP2-12 Temporal unavailable → deny.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { afterEach, describe, expect, it } from "vitest";
import { createResolveConfig } from "../src/activities/resolve-config.js";
import { createRunTurn, type PermissionWorkflowClient } from "../src/activities/run-turn.js";
import { NodeStore } from "../src/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T-V1-WP2-11 / 12 ask mode node path", () => {
  it("T-V1-WP2-11 ask on vibe (no permissionCallbacks) → mode-unsupported", async () => {
    const backend = new MemoryBackend();
    await initOrg(backend);
    const agent = await createAgent(backend, {
      handle: "vibe-bot",
      harness: "vibe",
      mode: "ask",
    });
    const resolve = createResolveConfig({
      backendForOrg: () => backend,
      ownerIdsForOrg: () => ["owner"],
      workdirRoots: [tmpdir()],
      stateDir: tmpdir(),
    });
    const cfg = await resolve({ orgId: "o", spaceId: "s", agentId: agent.agentId });
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) {
      expect(cfg.reason).toBe("mode-unsupported");
      expect(cfg.detail).toMatch(/permission callbacks|ask/i);
    }
  });

  it("T-V1-WP2-12 permission client failure → deny never allow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-deny-"));
    dirs.push(dir);
    const store = new NodeStore(join(dir, "n.sqlite"));
    const failingClient: PermissionWorkflowClient = {
      executePermission: async () => {
        throw new Error("temporal down");
      },
    };
    let sawDenyReason: string | undefined;
    const runTurn = createRunTurn({
      store,
      permissionClient: failingClient,
      openSession: async () => {
        const session = {
          handle: { sessionId: "s1" },
          prompt: async (
            _m: unknown,
            _onPartial: unknown,
            onPermission: (r: {
              toolName: string;
              kind: string;
              options: Array<{ optionId: string; kind: string }>;
            }) => Promise<{ outcome: string; optionId: string; reason?: string }>,
          ) => {
            const d = await onPermission({
              toolName: "Edit",
              kind: "edit",
              options: [
                { optionId: "allow", kind: "allow" },
                { optionId: "reject", kind: "reject" },
              ],
            });
            sawDenyReason = d.reason;
            return { text: "done", stopReason: "end_turn" };
          },
          cancel: () => {},
          close: async () => {},
          kill: () => {},
        };
        return { session: session as never, resumed: "none" };
      },
    });
    await runTurn({
      orgId: "o",
      spaceId: "s",
      agentId: "a",
      workflowId: "wf",
      chatId: "c",
      messageId: "m",
      authorId: "u",
      text: "edit please",
      spec: {
        handle: "h",
        harness: "fake",
        chatId: "c",
        approvalMode: "ask",
        allowedAuthors: ["u"],
        lifecycle: "live",
        instructions: "",
        workdir: dir,
      },
    });
    expect(sawDenyReason).toMatch(/approval service unavailable/);
    store.close();
  });
});
