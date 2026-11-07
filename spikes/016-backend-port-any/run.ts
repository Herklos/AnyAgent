// Spike 016: the backend port against `any`.
//
//   node spikes/016-backend-port-any/run.ts                       # reference backend + "the suite can fail" only
//   ANY_SPIKE_ALLOW_NETWORK_ID=<id> node spikes/016-backend-port-any/run.ts   # ...and a local `any` server
//
// The `any` run is refused unless the server reports exactly the network id you named. That is the guard against
// writing to Anytype's production network by accident: name the id of a throwaway network (README).
import { AnyBackend } from "./any-backend.ts";
import { MemoryBackend } from "./memory-backend.ts";
import { runSuite, type Ctx, type Result } from "./conformance.ts";
import { SCHEMA } from "./schema.ts";

const ANY_URL = process.env.ANY_URL ?? "http://127.0.0.1:2046";
const ALLOWED_NETWORK = process.env.ANY_SPIKE_ALLOW_NETWORK_ID;

let failed = 0;
function print(title: string, results: Result[]) {
  console.log(`\n== ${title}`);
  for (const r of results) {
    const mark = r.status === "pass" ? "PASS" : r.status === "skip" ? "SKIP" : "FAIL";
    console.log(`${mark} ${r.name}${r.detail ? `\n       ${r.detail}` : ""}`);
    if (r.status === "fail") failed++;
  }
  const n = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  console.log(`-- ${n("pass")} passed, ${n("fail")} failed, ${n("skip")} skipped`);
}

// 1. The reference backend: the suite is about the port, not about `any`.
{
  const b = new MemoryBackend();
  print("memory (reference implementation)", await runSuite({ backend: b, admin: b }));
}

// 2. The suite must be able to fail: a backend that ignores the resume cursor has to be caught, and for the right
//    reason (the check's own assertion about what comes back, not a setup error).
{
  const b = new MemoryBackend({ replayAll: true });
  await b.ensureSchema(SCHEMA);
  const results = await runSuite({ backend: b, admin: b }, (c) => c.name.startsWith("events (chat, resume)"));
  const r = results[0];
  const caught = results.length === 1 && r!.status === "fail" && /exactly the changed ones|nothing at or before the cursor/.test(r!.detail ?? "");
  console.log(`\n== mutation: a backend that replays everything on resume`);
  console.log(`${caught ? "PASS" : "FAIL"} the resume check fails on it, for the right reason`);
  console.log(`       ${r?.status}: ${r?.detail?.slice(0, 160)}`);
  if (!caught) failed++;
}

// 3. A local `any` server.
if (!ALLOWED_NETWORK) {
  console.log("\n== any: skipped (set ANY_SPIKE_ALLOW_NETWORK_ID to the throwaway network's id; see README)");
} else {
  const health = await AnyBackend.health(ANY_URL).catch((e) => {
    console.log(`\n== any: no server at ${ANY_URL} (${e instanceof Error ? e.message : e})`);
    return undefined;
  });
  if (health) {
    if (health.networkId !== ALLOWED_NETWORK) {
      console.error(`\nrefusing to run: the server is on network ${health.networkId}, not the allowed ${ALLOWED_NETWORK}`);
      process.exit(2);
    }
    // a fault injector: remembers every live stream so the suite can cut them
    const live = new Set<AbortController>();
    const chaosFetch: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/subscribe")) return fetch(input, init);
      const ac = new AbortController();
      live.add(ac);
      init?.signal?.addEventListener("abort", () => ac.abort(), { once: true });
      return fetch(input, { ...init, signal: ac.signal });
    };
    const space = await AnyBackend.createSpace(ANY_URL, `spike-016-${Date.now().toString(36)}`);
    const b = new AnyBackend(ANY_URL, space, chaosFetch);
    const ctx: Ctx = {
      backend: b,
      admin: b,
      killStreams: () => {
        const n = live.size;
        for (const ac of live) ac.abort();
        live.clear();
        return n;
      },
    };
    console.log(`\nany: ${health.version}, network ${health.networkId}, account ${health.account}, space ${space.slice(0, 12)}…`);
    print("any (anyproto/any, local server, placeholder network)", await runSuite(ctx));
    console.log(`capabilities: ${[...b.capabilities].join(", ")}`);
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nall green");
process.exit(failed ? 1 : 0);
