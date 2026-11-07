#!/usr/bin/env node
/**
 * Every relative Markdown link under docs/, README.md, AGENTS.md must resolve
 * to an existing file or directory.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} dir */
function listMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(path));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

const files = [
  ...listMarkdown(join(ROOT, "docs")),
  join(ROOT, "README.md"),
  join(ROOT, "AGENTS.md"),
].filter((p) => existsSync(p));

/** @type {string[]} */
const broken = [];

/** Markdown links: [text](url) — skip http(s), mailto, anchors-only */
const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LINK_RE)) {
    let target = match[1].trim();
    // Strip optional title: url "title"
    const space = target.search(/\s+/);
    if (space !== -1) target = target.slice(0, space);
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.startsWith("#") ||
      target.startsWith("skill://") ||
      target.startsWith("notion://")
    ) {
      continue;
    }
    const hash = target.indexOf("#");
    const pathPart = hash === -1 ? target : target.slice(0, hash);
    if (!pathPart) continue; // same-file anchor
    const resolved = resolve(dirname(file), pathPart);
    if (!existsSync(resolved)) {
      broken.push(`${relative(ROOT, file)}: ${target} -> missing ${relative(ROOT, resolved)}`);
    }
  }
}

if (broken.length > 0) {
  console.error("docs-check failed: broken relative links:");
  for (const b of broken) console.error(`  - ${b}`);
  process.exit(1);
}

console.log(`ok: ${files.length} markdown files, all relative links resolve`);
