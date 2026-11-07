/**
 * Copied from spikes/016-backend-port-any/conformance.ts.
 * Licence: Apache-2.0 (same as anyagent).
 * Changes: ESM .js imports; Conflict from errors; new body/chat.create checks;
 * runConformance alias; vitest-friendly export.
 */

import assert from "node:assert/strict";
import { Conflict as ConflictError } from "../errors.js";
import {
  type Backend,
  type Capability,
  compareCursor,
  type SchemaAdmin,
  type WatchEvent,
  type WatchSpec,
} from "../port.js";
import { SCHEMA } from "./schema.js";

export interface Ctx {
  backend: Backend;
  admin: SchemaAdmin;
  /** Optional: drop every live stream the backend holds open (a network fault). */
  killStreams?: () => number;
}

export interface Check {
  name: string;
  needs?: Capability[];
  needsHook?: "killStreams";
  run(ctx: Ctx): Promise<void>;
}

const tag = Date.now().toString(36);
let counter = 0;
const uniq = (p: string) => `${p}-${tag}-${++counter}`;

/** Runs a watch in the background, collecting events. */
class Watcher {
  events: WatchEvent[] = [];
  private ac = new AbortController();
  private done: Promise<void>;
  private waiters: Array<() => void> = [];
  error?: unknown;

  constructor(backend: Backend, spec: WatchSpec, after?: string) {
    this.done = (async () => {
      try {
        const opts = {
          signal: this.ac.signal,
          ...(after !== undefined ? { after } : {}),
        };
        for await (const e of backend.events.watch(spec, opts)) {
          this.events.push(e);
          for (const w of this.waiters.splice(0)) w();
        }
      } catch (e) {
        this.error = e;
        for (const w of this.waiters.splice(0)) w();
      }
    })();
  }

  async until(
    pred: (events: WatchEvent[]) => boolean,
    ms = 8000,
    what = "condition",
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (!pred(this.events)) {
      if (this.error) throw this.error;
      const left = deadline - Date.now();
      if (left <= 0)
        throw new Error(
          `timed out waiting for ${what}; saw ${JSON.stringify(this.events.map(brief))}`,
        );
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  async stop(): Promise<void> {
    this.ac.abort();
    await this.done;
  }
}

const brief = (e: WatchEvent) => (e.kind === "ready" ? "ready" : `${e.kind}:${e.op}:${e.id}`);
const isReady = (e: WatchEvent) => e.kind === "ready";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newGroup(b: Backend, name = uniq("group")) {
  return b.objects.create("aa_group", { name, fields: { aa_handle: name } });
}

export const CHECKS: Check[] = [
  {
    name: "schema: ensureSchema twice is harmless and the aa_* types are usable",
    async run({ backend, admin }) {
      await admin.ensureSchema(SCHEMA);
      await admin.ensureSchema(SCHEMA);
      assert.deepEqual(await backend.org.list("aa_prompt", { aa_kind: "no-such-kind" }), []);
    },
  },
  {
    name: "identity: self is stable, and what it posts is attributed to it",
    async run({ backend }) {
      const a = await backend.identity.self();
      const b = await backend.identity.self();
      assert.ok(a.id.length > 0);
      assert.equal(a.id, b.id);
      const g = await newGroup(backend);
      const m = await backend.chat.post(g.id, { text: "who am i" });
      assert.equal(m.authorId, a.id);
    },
  },
  {
    name: "identity (roles): the connection's own role is owner",
    needs: ["roles"],
    async run({ backend }) {
      const me = await backend.identity.self();
      assert.equal(await backend.identity.roleOf(me.id), "owner");
    },
  },
  {
    name: "org: an agent with a prompt and a manager reads back with typed fields and relations as object ids",
    async run({ backend }) {
      const prompt = await backend.objects.create("aa_prompt", {
        name: uniq("prompt"),
        fields: { aa_kind: "system", aa_text: "You are the chief." },
      });
      const chief = await backend.objects.create("aa_agent", {
        name: uniq("chief"),
        fields: {
          aa_handle: "chief",
          aa_harness: "claude-code",
          aa_approval_mode: "ask",
          aa_prompt: [prompt.id],
        },
      });
      const dev = await backend.objects.create("aa_agent", {
        name: uniq("dev"),
        fields: {
          aa_handle: "dev",
          aa_harness: "openai",
          aa_prompt: [prompt.id],
          aa_reports_to: [chief.id],
        },
      });
      const got = await backend.org.get(dev.id);
      assert.ok(got);
      assert.equal(got.type, "aa_agent");
      assert.equal(got.fields.aa_harness, "openai"); // a select is a string, not an array
      assert.deepEqual(got.fields.aa_reports_to, [chief.id]); // a relation is object ids
      assert.deepEqual(got.fields.aa_prompt, [prompt.id]);
      const p = await backend.org.get(prompt.id);
      assert.equal(p?.fields.aa_text, "You are the chief.");
      const claude = await backend.org.list("aa_agent", { aa_harness: "claude-code" });
      assert.ok(claude.some((a) => a.id === chief.id));
      assert.ok(!claude.some((a) => a.id === dev.id));
    },
  },
  {
    name: "objects: a patch changes only its own fields; each field has its own version",
    needs: ["field-versions"],
    async run({ backend }) {
      const t = await backend.objects.create("aa_task", {
        name: uniq("task"),
        fields: { aa_status: "todo", aa_attempts: 1 },
      });
      const before = (await backend.org.get(t.id))!;
      await sleep(1100); // timestamps are second-resolution; versions must not depend on them
      const after = await backend.objects.update(t.id, { aa_status: "in_progress" });
      assert.equal(after.fields.aa_status, "in_progress");
      assert.equal(after.fields.aa_attempts, 1);
      assert.notEqual(after.fieldVersions.aa_status, before.fieldVersions.aa_status);
      assert.equal(after.fieldVersions.aa_attempts, before.fieldVersions.aa_attempts);
      assert.equal(after.modifiedById, (await backend.identity.self()).id);
    },
  },
  {
    name: "objects: a write that names a stale field version is refused; a fresh one goes through",
    needs: ["field-versions"],
    async run({ backend }) {
      const t = await backend.objects.create("aa_task", {
        name: uniq("task"),
        fields: { aa_status: "todo" },
      });
      const read = (await backend.org.get(t.id))!;
      await backend.objects.update(t.id, { aa_status: "in_progress" });
      await assert.rejects(
        backend.objects.update(
          t.id,
          { aa_status: "done" },
          { expect: { aa_status: read.fieldVersions.aa_status! } },
        ),
        ConflictError,
      );
      const fresh = (await backend.org.get(t.id))!;
      const ok = await backend.objects.update(
        t.id,
        { aa_status: "review" },
        { expect: { aa_status: fresh.fieldVersions.aa_status! } },
      );
      assert.equal(ok.fields.aa_status, "review");
    },
  },
  {
    name: "objects: a null patch clears a field",
    async run({ backend }) {
      const t = await backend.objects.create("aa_task", {
        name: uniq("task"),
        fields: { aa_status: "todo", aa_attempts: 3 },
      });
      const u = await backend.objects.update(t.id, { aa_attempts: null });
      assert.ok(u.fields.aa_attempts === undefined || u.fields.aa_attempts === null);
      assert.equal(u.fields.aa_status, "todo");
    },
  },
  {
    name: "chat: a group object is its own chat, separate from the general chat",
    async run({ backend }) {
      const g1 = await newGroup(backend);
      const g2 = await newGroup(backend);
      const general = await backend.chat.general();
      await backend.chat.post(g1.id, { text: "only in g1" });
      assert.deepEqual(
        (await backend.chat.history(g1.id)).map((m) => m.text),
        ["only in g1"],
      );
      assert.deepEqual(await backend.chat.history(g2.id), []);
      assert.ok(!(await backend.chat.history(general)).some((m) => m.text === "only in g1"));
    },
  },
  {
    name: "chat: history is oldest first; edit marks edited and keeps its place; a reply names its target",
    async run({ backend }) {
      const g = await newGroup(backend);
      const a = await backend.chat.post(g.id, { text: "first" });
      const b = await backend.chat.post(g.id, { text: "second", replyTo: a.id });
      assert.equal(b.replyTo, a.id);
      assert.equal(a.edited, false);
      await sleep(1100);
      const e = await backend.chat.edit(g.id, a.id, "first, edited");
      assert.equal(e.edited, true);
      assert.equal(e.text, "first, edited");
      const h = await backend.chat.history(g.id);
      assert.deepEqual(
        h.map((m) => m.id),
        [a.id, b.id],
      );
    },
  },
  {
    name: "chat (agent envelope): done:false then done:true with an outcome round-trips; control messages carry no content",
    needs: ["agent-envelope"],
    async run({ backend }) {
      const g = await newGroup(backend);
      const working = await backend.chat.post(g.id, {
        text: "on it",
        agent: { name: "chief", done: false },
      });
      assert.deepEqual(working.agent, { name: "chief", done: false });
      const end = await backend.chat.post(g.id, {
        text: "stopped",
        agent: { name: "chief", done: true, outcome: "interrupted" },
      });
      assert.equal(end.agent?.done, true);
      assert.equal(end.agent?.outcome, "interrupted");
      const stop = await backend.chat.post(g.id, { control: { kind: "break", hard: true } });
      assert.deepEqual(stop.control, { kind: "break", hard: true });
      assert.equal(stop.text, "");
    },
  },
  {
    name: "chat: react is idempotent in both directions and leaves no empty emoji behind",
    async run({ backend }) {
      const g = await newGroup(backend);
      const me = (await backend.identity.self()).id;
      const m = await backend.chat.post(g.id, { text: "approve?" });
      await backend.chat.react(g.id, m.id, "✅", true);
      const twice = await backend.chat.react(g.id, m.id, "✅", true);
      assert.deepEqual(twice.reactions, { "✅": [me] });
      await backend.chat.react(g.id, m.id, "✅", false);
      const gone = await backend.chat.react(g.id, m.id, "✅", false);
      assert.deepEqual(gone.reactions, {});
      assert.deepEqual((await backend.chat.get(g.id, m.id))?.reactions, {});
    },
  },
  {
    name: "events (chat, live): ready, then added, updated (edit), updated (reaction), removed, with rising cursors",
    async run({ backend }) {
      const g = await newGroup(backend);
      const w = new Watcher(backend, { kind: "chat", chatId: g.id });
      try {
        await w.until((e) => e.some(isReady), 8000, "ready");
        const m = await backend.chat.post(g.id, {
          text: "live",
          agent: { name: "bot", done: false },
        });
        await w.until(
          (e) => e.some((x) => x.kind === "chat" && x.op === "added" && x.id === m.id),
          8000,
          "added",
        );
        await backend.chat.edit(g.id, m.id, "live!");
        await w.until(
          (e) =>
            e.some((x) => x.kind === "chat" && x.op === "updated" && x.message?.text === "live!"),
          8000,
          "edit",
        );
        await backend.chat.react(g.id, m.id, "👀", true);
        await w.until(
          (e) => e.some((x) => x.kind === "chat" && x.message?.reactions["👀"]),
          8000,
          "reaction",
        );
        await backend.chat.remove(g.id, m.id);
        await w.until(
          (e) => e.some((x) => x.kind === "chat" && x.op === "removed" && x.id === m.id),
          8000,
          "removed",
        );

        const first = w.events[0];
        assert.equal(
          first?.kind,
          "ready",
          "nothing may precede ready on a fresh watch of an empty chat",
        );
        const cursors = w.events.flatMap((x) => (x.kind === "chat" && x.cursor ? [x.cursor] : []));
        for (let i = 1; i < cursors.length; i++)
          assert.ok(compareCursor(cursors[i - 1]!, cursors[i]!) < 0, `cursor order ${cursors}`);
        const added = w.events.find((x) => x.kind === "chat" && x.op === "added");
        assert.equal(
          added?.kind === "chat" && added.message?.authorId,
          (await backend.identity.self()).id,
          "events carry the author (loop guard)",
        );
        assert.equal(added?.kind === "chat" && added.message?.agent?.name, "bot");
      } finally {
        await w.stop();
      }
    },
  },
  {
    name: "events (chat, resume): after a gap, exactly what changed comes back once, in order; nothing older; then live",
    needs: ["resume-cursor", "removal-resume"],
    async run({ backend }) {
      const g = await newGroup(backend);
      const m0 = await backend.chat.post(g.id, { text: "zero" });
      const m1 = await backend.chat.post(g.id, { text: "one" });
      const w1 = new Watcher(backend, { kind: "chat", chatId: g.id });
      let cursor: string;
      try {
        await w1.until((e) => e.some(isReady), 8000, "ready");
        const probe = await backend.chat.post(g.id, { text: "seen before the gap" });
        await w1.until((e) => e.some((x) => x.kind === "chat" && x.id === probe.id), 8000, "probe");
        const seen = w1.events.find((x) => x.kind === "chat" && x.id === probe.id)!;
        cursor = (seen as { cursor: string }).cursor;
      } finally {
        await w1.stop();
      }
      // the gap: the watcher is gone
      const m2 = await backend.chat.post(g.id, { text: "two" });
      const m3 = await backend.chat.post(g.id, { text: "three" });
      await backend.chat.edit(g.id, m1.id, "one, edited");
      await backend.chat.react(g.id, m1.id, "👀", true);
      await backend.chat.remove(g.id, m0.id);

      const w2 = new Watcher(backend, { kind: "chat", chatId: g.id }, cursor);
      try {
        await w2.until((e) => e.some(isReady), 8000, "ready after resume");
        const caught = w2.events.filter((e) => !isReady(e)) as Extract<
          WatchEvent,
          { kind: "chat" }
        >[];
        const ids = caught.map((e) => e.id);
        assert.equal(new Set(ids).size, ids.length, `no duplicates: ${ids}`);
        assert.deepEqual(
          new Set(ids),
          new Set([m0.id, m1.id, m2.id, m3.id]),
          `exactly the changed ones: ${ids}`,
        );
        assert.equal(caught.find((e) => e.id === m0.id)?.op, "removed");
        const one = caught.find((e) => e.id === m1.id)!;
        assert.equal(one.message?.text, "one, edited");
        assert.deepEqual(one.message?.reactions["👀"], [(await backend.identity.self()).id]);
        const cs = caught.flatMap((e) => (e.cursor ? [e.cursor] : []));
        for (let i = 0; i < cs.length; i++)
          assert.ok(compareCursor(cs[i]!, cursor) > 0, "nothing at or before the cursor");
        for (let i = 1; i < cs.length; i++)
          assert.ok(compareCursor(cs[i - 1]!, cs[i]!) < 0, "ascending");
        // and the stream is live afterwards
        const m4 = await backend.chat.post(g.id, { text: "four" });
        await w2.until(
          (e) => e.some((x) => x.kind === "chat" && x.id === m4.id),
          8000,
          "live after resume",
        );
        const m4Events = w2.events.filter((x) => x.kind === "chat" && x.id === m4.id);
        assert.equal(m4Events.length, 1, "delivered once");
      } finally {
        await w2.stop();
      }
    },
  },
  {
    name: "events (chat, race): messages posted while a resuming watch is starting up arrive once each, in order",
    needs: ["resume-cursor"],
    async run({ backend }) {
      const g = await newGroup(backend);
      const first = await backend.chat.post(g.id, { text: "anchor" });
      const cursor = first.cursor;
      // start the watch and write at the same time: some posts land before the live stream, some during the
      // catch-up read, some after; every one must be delivered exactly once
      const w = new Watcher(backend, { kind: "chat", chatId: g.id }, cursor);
      const sent: string[] = [];
      try {
        for (let i = 0; i < 40; i++) {
          sent.push((await backend.chat.post(g.id, { text: `race ${i}` })).id);
        }
        await w.until(
          (e) => sent.every((id) => e.some((x) => x.kind === "chat" && x.id === id)),
          15000,
          "all 40",
        );
        const seen = w.events.filter((x) => x.kind === "chat").map((x) => (x as { id: string }).id);
        assert.equal(
          seen.length,
          new Set(seen).size,
          `duplicates: ${seen.filter((id, i) => seen.indexOf(id) !== i)}`,
        );
        assert.deepEqual(seen, sent, "in the order posted");
      } finally {
        await w.stop();
      }
    },
  },
  {
    name: "events (chat, fault): a dropped stream reconnects by itself and delivers what happened meanwhile once",
    needs: ["resume-cursor"],
    needsHook: "killStreams",
    async run({ backend, killStreams }) {
      const g = await newGroup(backend);
      const w = new Watcher(backend, { kind: "chat", chatId: g.id });
      try {
        await w.until((e) => e.some(isReady), 8000, "ready");
        const m1 = await backend.chat.post(g.id, { text: "before the fault" });
        await w.until((e) => e.some((x) => x.kind === "chat" && x.id === m1.id), 8000, "m1");
        assert.ok(killStreams!() > 0, "the fault injector cut at least one live stream");
        const m2 = await backend.chat.post(g.id, { text: "during" });
        const m3 = await backend.chat.post(g.id, { text: "during too" });
        await w.until(
          (e) => [m2.id, m3.id].every((id) => e.some((x) => x.kind === "chat" && x.id === id)),
          12000,
          "m2 and m3",
        );
        const per = (id: string) => w.events.filter((x) => x.kind === "chat" && x.id === id).length;
        assert.equal(per(m1.id), 1, "m1 not repeated");
        assert.equal(per(m2.id), 1);
        assert.equal(per(m3.id), 1);
        const order = w.events
          .filter((x) => x.kind === "chat")
          .map((x) => (x as { id: string }).id);
        assert.deepEqual(order, [m1.id, m2.id, m3.id]);
      } finally {
        await w.stop();
      }
    },
  },
  {
    name: "events (objects): initial state, then added and updated with the new field values",
    async run({ backend }) {
      const a = await backend.objects.create("aa_task", {
        name: uniq("task-a"),
        fields: { aa_status: "todo" },
      });
      const w = new Watcher(backend, { kind: "objects", type: "aa_task" });
      try {
        await w.until((e) => e.some(isReady), 8000, "ready");
        const before = w.events.slice(0, w.events.findIndex(isReady));
        assert.ok(
          before.some((x) => x.kind === "object" && x.id === a.id && x.op === "upsert"),
          "initial state includes existing tasks",
        );
        const b = await backend.objects.create("aa_task", {
          name: uniq("task-b"),
          fields: { aa_status: "todo" },
        });
        await w.until(
          (e) => e.some((x) => x.kind === "object" && x.id === b.id && x.op === "added"),
          8000,
          "added",
        );
        await backend.objects.update(a.id, { aa_status: "done" });
        await w.until(
          (e) =>
            e.some(
              (x) =>
                x.kind === "object" &&
                x.id === a.id &&
                x.op === "updated" &&
                x.object?.fields.aa_status === "done",
            ),
          8000,
          "updated",
        );
      } finally {
        await w.stop();
      }
    },
  },
  {
    name: "events (objects, resume): objects created or changed during a gap come back once",
    needs: ["resume-cursor"],
    async run({ backend }) {
      const a = await backend.objects.create("aa_task", {
        name: uniq("task-a"),
        fields: { aa_status: "todo" },
      });
      const w1 = new Watcher(backend, { kind: "objects", type: "aa_task" });
      let cursor: string;
      try {
        await w1.until((e) => e.some(isReady), 8000, "ready");
        const probe = await backend.objects.create("aa_task", {
          name: uniq("probe"),
          fields: { aa_status: "todo" },
        });
        await w1.until(
          (e) => e.some((x) => x.kind === "object" && x.id === probe.id),
          8000,
          "probe",
        );
        cursor = (
          w1.events.find((x) => x.kind === "object" && x.id === probe.id) as { cursor: string }
        ).cursor;
      } finally {
        await w1.stop();
      }
      await backend.objects.update(a.id, { aa_status: "review" });
      const c = await backend.objects.create("aa_task", {
        name: uniq("task-c"),
        fields: { aa_status: "todo" },
      });
      const w2 = new Watcher(backend, { kind: "objects", type: "aa_task" }, cursor);
      try {
        await w2.until((e) => e.some(isReady), 8000, "ready after resume");
        const ids = w2.events
          .filter((e) => e.kind === "object")
          .map((e) => (e as { id: string }).id);
        assert.deepEqual(new Set(ids), new Set([a.id, c.id]), `exactly the changed ones: ${ids}`);
        assert.equal(ids.length, 2, "once each");
      } finally {
        await w2.stop();
      }
    },
  },
  {
    name: "org: get returns body; list never includes body",
    async run({ backend }) {
      const o = await backend.objects.create("aa_prompt", {
        name: uniq("with-body"),
        fields: { aa_kind: "system", aa_text: "x" },
        body: "# instructions\nBe helpful.",
      });
      const got = await backend.org.get(o.id);
      assert.equal(got?.body, "# instructions\nBe helpful.");
      const listed = await backend.org.list("aa_prompt", { aa_kind: "system" });
      const row = listed.find((r) => r.id === o.id);
      assert.ok(row);
      assert.equal(row.body, undefined);
    },
  },
  {
    name: "chat: create returns a usable chat id that accepts posts",
    async run({ backend }) {
      const id = await backend.chat.create({ name: uniq("room") });
      assert.ok(id.length > 0);
      const m = await backend.chat.post(id, { text: "hello new chat" });
      assert.equal(m.chatId, id);
      assert.deepEqual(
        (await backend.chat.history(id)).map((x) => x.text),
        ["hello new chat"],
      );
    },
  },
];

export interface Result {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

export async function runSuite(ctx: Ctx, only?: (c: Check) => boolean): Promise<Result[]> {
  const out: Result[] = [];
  for (const c of CHECKS) {
    if (only && !only(c)) continue;
    const missing = (c.needs ?? []).filter((n) => !ctx.backend.capabilities.has(n));
    if (missing.length) {
      out.push({ name: c.name, status: "skip", detail: `needs ${missing.join(", ")}` });
      continue;
    }
    if (c.needsHook && !ctx[c.needsHook]) {
      out.push({ name: c.name, status: "skip", detail: `needs hook ${c.needsHook}` });
      continue;
    }
    try {
      await c.run(ctx);
      out.push({ name: c.name, status: "pass" });
    } catch (e) {
      out.push({
        name: c.name,
        status: "fail",
        detail: e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e),
      });
    }
  }
  return out;
}

/** WP1 name: returns results; the vitest file turns each into a test. */
export async function runConformance(ctx: Ctx, only?: (c: Check) => boolean): Promise<Result[]> {
  return runSuite(ctx, only);
}
