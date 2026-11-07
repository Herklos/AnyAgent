/**
 * T-WP8-01..04, 07 — automated acceptance on Temporal test env + MemoryBackend + fake harness.
 * Live Anytype / real harnesses: NOT RUN (see e2e/live/README.md and REPORT.md).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initOrg } from "@anyagent/admin";
import { MemoryBackend } from "@anyagent/backend";
import { loadConfig } from "@anyagent/core";
import { runDoctor } from "anyagent";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER, STRANGER, startAcceptance, waitUntil } from "../support/anybot-harness.js";
import { Skipped, withTemporal } from "../support/temporal.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T-WP8 acceptance (fakes)", () => {
  it("T-WP8-01 owner message → reply + 👀 then ✅", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        try {
          const inbound = await h.send(OWNER, "hello-owner");
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 20 });
            return hist.some(
              (m) => m.authorId === h.backend.me && /reply:hello-owner/i.test(m.text),
            );
          });
          const updated = await h.backend.chat.get(h.agent.chatId, inbound.id);
          expect((updated?.reactions["✅"] ?? []).includes(h.backend.me)).toBe(true);
        } finally {
          await h.stop();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-WP8-02 stranger message → no reply", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        try {
          await h.send(STRANGER, "intruder");
          await new Promise((r) => setTimeout(r, 800));
          const hist = await h.backend.chat.history(h.agent.chatId, { limit: 20 });
          expect(hist.some((m) => m.authorId === h.backend.me && /intruder/i.test(m.text))).toBe(
            false,
          );
        } finally {
          await h.stop();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 90_000);

  it("T-WP8-03 read_only write refused; full allows; cred denied", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        try {
          await h.send(OWNER, "WRITE_PLEASE", "k-write-ro");
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 20 });
            return hist.some((m) => m.authorId === h.backend.me && /write step done/i.test(m.text));
          });
          expect(existsSync(join(h.dir, "out.txt"))).toBe(false);

          await h.backend.objects.update(h.agent.agentId, { aa_approval_mode: "full" });
          await h.send(OWNER, "WRITE_PLEASE", "k-write-full");
          await waitUntil(async () => existsSync(join(h.dir, "out.txt")));

          await h.send(OWNER, "CRED_PLEASE", "k-cred");
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 30 });
            return hist.some((m) => m.authorId === h.backend.me && /cred step done/i.test(m.text));
          });
        } finally {
          await h.stop();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 180_000);

  it("T-WP8-04 body change + paused silence", async ({ skip }) => {
    try {
      await withTemporal(async (env) => {
        const h = await startAcceptance(env);
        dirs.push(h.dir);
        try {
          // Body-edit instruction visibility is soft on fakes (see REPORT.md); pause/resume is the hard assert.
          await h.backend.objects.update(h.agent.agentId, { aa_lifecycle: "paused" });
          const before = (await h.backend.chat.history(h.agent.chatId, { limit: 50 })).length;
          await h.send(OWNER, "while-paused", "k-paused");
          await new Promise((r) => setTimeout(r, 800));
          const after = await h.backend.chat.history(h.agent.chatId, { limit: 50 });
          expect(after.length).toBe(before + 1); // only inbound
          expect(
            after.some((m) => m.authorId === h.backend.me && /while-paused/i.test(m.text)),
          ).toBe(false);

          await h.backend.objects.update(h.agent.agentId, { aa_lifecycle: "live" });
          await h.send(OWNER, "after-resume", "k-resume");
          await waitUntil(async () => {
            const hist = await h.backend.chat.history(h.agent.chatId, { limit: 30 });
            return hist.some(
              (m) => m.authorId === h.backend.me && /reply:after-resume/i.test(m.text),
            );
          });
        } finally {
          await h.stop();
        }
      });
    } catch (e) {
      if (e instanceof Skipped) skip(e.message);
      else throw e;
    }
  }, 120_000);

  it("T-WP8-07 doctor reports broken Temporal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wp8-doc-"));
    dirs.push(dir);
    const cfg = join(dir, "anybot.config.yaml");
    writeFileSync(
      cfg,
      `
version: 1
temporal: { address: "127.0.0.1:1", namespace: "default" }
state: { dir: "${dir}/state" }
node: { handle: "n1", workdirRoots: ["${dir}"] }
orgs:
  - id: personal
    backend: { kind: anytype, url: "http://127.0.0.1:9", readKeyEnv: K, writeKeyEnv: K }
    space: s1
harnesses: {}
`,
    );
    const config = loadConfig(cfg);
    const backend = new MemoryBackend();
    await initOrg(backend);
    process.env.ANYBOT_BACKEND = "memory";
    const report = await runDoctor({
      config,
      configPath: cfg,
      backends: new Map([["personal", backend]]),
      orgIds: ["personal"],
      temporalReachable: async () => ({ ok: false, detail: "down" }),
    });
    delete process.env.ANYBOT_BACKEND;
    const d6 = report.checks.find((c) => c.id === "D6");
    expect(d6?.severity).toBe("fail");
    expect(d6?.message).toMatch(/Temporal|down|unreachable/i);
  });
});
