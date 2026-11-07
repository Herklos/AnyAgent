#!/usr/bin/env node
/**
 * Evaluate ADR 0019 / research §9 criteria for adopting @temporalio/agent-harness.
 * Never installs into the repository: --latest uses a scratch dir under os.tmpdir().
 *
 * Usage:
 *   node scripts/harness-criteria.mjs --fixture <dir>
 *   node scripts/harness-criteria.mjs --latest
 *   node scripts/harness-criteria.mjs --check-carryover
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUR_SDK = "1.24.0";

function die(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function assertOutsideRepo(target) {
  const abs = resolve(target);
  const rel = relative(ROOT, abs);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    die(`refusing to use target inside repository: ${abs} (repo root ${ROOT})`);
  }
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else if (/\.(js|mjs|cjs|ts|d\.ts|json|md)$/.test(name)) acc.push(p);
  }
  return acc;
}

function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function loadMeta(pkgDir) {
  const metaPath = join(pkgDir, "criteria-meta.json");
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, "utf8"));
  }
  return {};
}

/**
 * @returns {{ id: number, name: string, pass: boolean, evidence: string }[]}
 */
function evaluatePackage(pkgDir, opts = {}) {
  const meta = loadMeta(pkgDir);
  const pkgJsonPath = join(pkgDir, "package.json");
  const pkg = existsSync(pkgJsonPath) ? JSON.parse(readFileSync(pkgJsonPath, "utf8")) : {};
  const files = walkFiles(pkgDir);
  const blob = files.map((f) => readText(f)).join("\n");

  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  const temporalRange =
    deps["@temporalio/workflow"] ??
    deps["@temporalio/common"] ??
    deps["@temporalio/worker"] ??
    "(none)";
  const deepImport = /@temporalio\/common\/lib\/time(\.js)?/.test(blob);
  // Fail criterion 1 when a deep import is present (breaks SDK ≥1.25). Meta can override for fixtures.
  const c1Pass = meta.criterion1 !== undefined ? Boolean(meta.criterion1) : !deepImport;
  const c1Evidence = deepImport
    ? `FAIL: deep import @temporalio/common/lib/time.js present; declared range ${temporalRange}; our pin ${OUR_SDK}`
    : `PASS: no deep import; declared range ${temporalRange}; our pin ${OUR_SDK}`;

  const hasPublicPermission =
    meta.criterion2 !== undefined
      ? Boolean(meta.criterion2)
      : /export\s+(type|interface|function|const|class)\s+\w*(Permission|Approval|ToolApproval)\w*/.test(
          blob,
        ) && !/@internal[\s\S]{0,80}(Permission|Approval)/.test(blob);
  // Heuristic: look for ToolApprovalPolicy as a public export without @internal nearby in .d.ts
  let c2Pass = hasPublicPermission;
  let c2Evidence;
  if (meta.criterion2 !== undefined) {
    c2Pass = Boolean(meta.criterion2);
    c2Evidence = meta.criterion2Evidence ?? (c2Pass ? "PASS (meta)" : "FAIL (meta)");
  } else if (blob.includes("ToolApprovalPolicy") && !blob.includes("@internal")) {
    c2Pass = true;
    c2Evidence = "PASS: ToolApprovalPolicy appears without @internal marker in scanned files";
  } else if (blob.includes("@internal") && /permission|approval/i.test(blob)) {
    c2Pass = false;
    c2Evidence = "FAIL: approval/permission path appears with @internal";
  } else {
    c2Pass = false;
    c2Evidence = "FAIL: no public exported permission/approval entry point found in package files";
  }

  const hasContinueAsNew =
    meta.criterion3 !== undefined ? Boolean(meta.criterion3) : /\bcontinueAsNew\b/.test(blob);
  const c3Pass = hasContinueAsNew;
  const c3Evidence = c3Pass
    ? "PASS: continueAsNew appears in package"
    : "FAIL: continueAsNew not found (absence may be acceptable if measured cost is none — see criterion 4)";

  // Criterion 4 needs a Temporal spike — N/A unless meta provides it.
  const c4Pass = meta.criterion4 === true;
  const c4Evidence =
    meta.criterion4Evidence ??
    "SKIP: needs harness-backed AgentCore spike + Temporal (not run when 1/2/5 fail)";

  // Criterion 5: API stability across two minor releases.
  let c5Pass;
  let c5Evidence;
  if (meta.criterion5 !== undefined) {
    c5Pass = Boolean(meta.criterion5);
    c5Evidence = meta.criterion5Evidence ?? (c5Pass ? "PASS (meta)" : "FAIL (meta)");
  } else if (opts.versionHistory) {
    const minors = opts.versionHistory;
    c5Pass = minors.stable === true;
    c5Evidence = minors.evidence;
  } else {
    c5Pass = false;
    c5Evidence =
      "FAIL: no two-minor stability evidence (pass meta.criterion5 or --latest version scan)";
  }

  // Criterion 6: contract suite — only if spike built.
  const c6Pass = meta.criterion6 === true;
  const c6Evidence =
    meta.criterion6Evidence ?? "SKIP: needs harness-backed core passing runCoreContract";

  return [
    { id: 1, name: "sdk-range-no-deep-import", pass: c1Pass, evidence: c1Evidence },
    {
      id: 2,
      name: "public-permission-api",
      pass: c2Pass,
      evidence: c2Evidence,
    },
    { id: 3, name: "continue-as-new", pass: c3Pass, evidence: c3Evidence },
    {
      id: 4,
      name: "history-cost-within-2x",
      pass: c4Pass,
      evidence: c4Evidence,
      skip: meta.criterion4 === undefined,
    },
    { id: 5, name: "api-stable-two-minors", pass: c5Pass, evidence: c5Evidence },
    {
      id: 6,
      name: "core-contract-passes",
      pass: c6Pass,
      evidence: c6Evidence,
      skip: meta.criterion6 === undefined,
    },
  ];
}

function printTable(rows) {
  process.stdout.write("criterion\tresult\tevidence\n");
  for (const r of rows) {
    const result = r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL";
    process.stdout.write(`${r.id}:${r.name}\t${result}\t${r.evidence}\n`);
  }
  const early = rows.filter((r) => r.id === 1 || r.id === 2 || r.id === 5);
  const earlyFail = early.some((r) => !r.pass);
  if (earlyFail) {
    process.stdout.write(
      "\nrecommendation: own gate (criterion 1, 2 or 5 failed — do not build harness spike)\n",
    );
  } else {
    process.stdout.write(
      "\nrecommendation: continue evaluation (criteria 1/2/5 ok — spike for 4/6 may proceed)\n",
    );
  }
}

function installLatestScratch() {
  const scratch = mkdtempSync(join(tmpdir(), "anyagent-harness-criteria-"));
  assertOutsideRepo(scratch);
  try {
    execFileSync(
      "npm",
      ["pack", "@temporalio/agent-harness@latest", "--pack-destination", scratch],
      {
        cwd: scratch,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const tgz = readdirSync(scratch).find((f) => f.endsWith(".tgz"));
    if (!tgz) die("npm pack produced no tarball");
    execFileSync("tar", ["-xzf", tgz], { cwd: scratch, encoding: "utf8" });
    const pkgDir = join(scratch, "package");
    if (!existsSync(pkgDir)) die("unpacked package/ missing");

    // Version history for criterion 5
    let versionHistory;
    try {
      const versionsRaw = execFileSync(
        "npm",
        ["view", "@temporalio/agent-harness", "versions", "--json"],
        { encoding: "utf8" },
      );
      const versions = JSON.parse(versionsRaw).filter((v) => !String(v).includes("stage"));
      const minors = new Set(
        versions
          .map((v) => {
            const m = String(v).match(/^(\d+)\.(\d+)\./);
            return m ? `${m[1]}.${m[2]}` : null;
          })
          .filter(Boolean),
      );
      // Experimental 0.x: many minors in days → not stable
      const stable = minors.size >= 2 && !String(versions.at(-1)).startsWith("0.");
      versionHistory = {
        stable,
        evidence: stable
          ? `PASS: versions ${versions.slice(-4).join(", ")}; minors ${[...minors].join(", ")}`
          : `FAIL: still 0.x with minors ${[...minors].join(", ")} (latest ${versions.at(-1)}); not stable across two minors for adoption`,
      };
    } catch (err) {
      versionHistory = {
        stable: false,
        evidence: `FAIL: could not read npm versions: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Scan for @internal in approval-related d.ts if present
    const rows = evaluatePackage(pkgDir, { versionHistory });
    // Refine criterion 2 from real package: look for @internal near permission in dist
    const distBlob = walkFiles(pkgDir).map(readText).join("\n");
    if (/@internal/.test(distBlob) && /ToolApproval|permission/i.test(distBlob)) {
      // Michel audit: permission bridge was @internal — if public ToolApprovalPolicy exists, keep pass for policy type
      // but fail if the only bridge is internal. Research: public ToolApprovalPolicy exists; external permission update used @internal.
      const idx = rows.findIndex((r) => r.id === 2);
      if (idx >= 0 && !/export\s+(async\s+)?function\s+\w*Permission/.test(distBlob)) {
        rows[idx] = {
          ...rows[idx],
          pass: false,
          evidence:
            "FAIL: package exposes ToolApproval types but no public external permission-request entry (Michel G37 @internal pattern still required for host bridge)",
        };
      }
    }
    printTable(rows);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkCarryover() {
  const report = readFileSync(join(ROOT, "docs/roadmap/v0/REPORT.md"), "utf8");
  const carry = readFileSync(join(ROOT, "docs/roadmap/v1/CARRYOVER.md"), "utf8");
  const limSection = report.split("## Known limitations")[1]?.split("## ")[0] ?? "";
  const bullets = [...limSection.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
  const missing = [];
  for (const b of bullets) {
    // Match by a distinctive fragment (first ~40 chars of plain text)
    const key = b.replace(/\*\*/g, "").slice(0, 40);
    if (!carry.includes(key.slice(0, 20))) {
      // try shorter tokens
      const tokens = b
        .replace(/[`*]/g, "")
        .split(/[;,(]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 12);
      if (!tokens.some((t) => carry.toLowerCase().includes(t.toLowerCase().slice(0, 24)))) {
        missing.push(b);
      }
    }
  }
  // Also require NOT RUN phrases from report
  for (const phrase of [
    "Live Anytype",
    "Spike 004",
    "Claude Code",
    "Codex",
    "kill -9",
    "Grok",
    "Vibe",
  ]) {
    if (!carry.includes(phrase) && !carry.toLowerCase().includes(phrase.toLowerCase())) {
      missing.push(`NOT RUN / topic missing: ${phrase}`);
    }
  }
  if (missing.length) {
    process.stdout.write(`carryover gaps:\n${missing.map((m) => `  - ${m}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("ok: CARRYOVER.md covers REPORT known limitations and NOT RUN topics\n");
  return 0;
}

const args = process.argv.slice(2);
if (args[0] === "--check-carryover") {
  process.exit(checkCarryover());
}
if (args[0] === "--fixture") {
  const dir = args[1];
  if (!dir) die("usage: --fixture <dir>");
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) die(`fixture not found: ${abs}`);
  printTable(evaluatePackage(abs));
  process.exit(0);
}
if (args[0] === "--latest") {
  process.exit(installLatestScratch());
}
if (args[0] === "--assert-outside-repo") {
  // test helper: try a path and exit 1 if inside repo
  const target = args[1] ?? ROOT;
  try {
    assertOutsideRepo(target);
    process.stdout.write("ok: outside\n");
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

die("usage: node scripts/harness-criteria.mjs --fixture <dir> | --latest | --check-carryover");
