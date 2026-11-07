#!/usr/bin/env node
/**
 * Fail if any @temporalio/* dependency is not exactly 1.24.0,
 * or if any @temporalio/agent-harness* package is present (Q20 / ADR 0019).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "1.24.0";
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** @param {string} dir */
function listPackageJsonFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPackageJsonFiles(path));
    else if (entry.name === "package.json") out.push(path);
  }
  return out;
}

/** @param {string} version */
function isExact(version) {
  return version === EXPECTED;
}

/** @type {string[]} */
const errors = [];

for (const pkgPath of listPackageJsonFiles(ROOT)) {
  const rel = pkgPath.slice(ROOT.length + 1);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, version] of Object.entries(deps)) {
      if (name.startsWith("@temporalio/agent-harness")) {
        errors.push(`${rel}: ${field}.${name} must not be present (Q20)`);
        continue;
      }
      if (name.startsWith("@temporalio/")) {
        if (!isExact(String(version))) {
          errors.push(`${rel}: ${field}.${name} is "${version}", expected exact "${EXPECTED}"`);
        }
      }
    }
  }
}

const lockPath = join(ROOT, "pnpm-lock.yaml");
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, "utf8");
  if (/@temporalio\/agent-harness/.test(lock)) {
    errors.push("pnpm-lock.yaml: contains @temporalio/agent-harness* (Q20)");
  }
  // Importers / packages sections: require resolved versions to be 1.24.0 when present.
  const bad = [...lock.matchAll(/@temporalio\/(?!agent-harness)[^\s@]+@([^\s(:]+)/g)];
  for (const m of bad) {
    const ver = m[1];
    if (ver && ver !== EXPECTED && !ver.startsWith(`${EXPECTED}(`)) {
      // pnpm lock uses forms like @temporalio/worker@1.24.0:
      if (!/^1\.24\.0/.test(ver)) {
        errors.push(`pnpm-lock.yaml: found @temporalio/*@${ver}, expected ${EXPECTED}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("check-pins failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`ok: ${EXPECTED} everywhere`);
