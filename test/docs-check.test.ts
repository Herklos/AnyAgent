import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_CHECK = join(ROOT, "scripts", "docs-check.mjs");

describe("T-WP0-02 docs-check and lint surface", () => {
  it("docs-check passes on the repository", () => {
    const out = execFileSync(process.execPath, [DOCS_CHECK], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toMatch(/^ok:/);
  });
});

describe("T-WP0-05 docs-check fails on a fixture with a broken link", () => {
  it("exits non-zero and lists the broken link", () => {
    const dir = mkdtempSync(join(tmpdir(), "anyagent-docs-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "README.md"), "[broken](docs/no-such-page.md)\n");
      writeFileSync(join(dir, "AGENTS.md"), "# agents\n");
      writeFileSync(join(dir, "docs", "ok.md"), "# ok\n");
      writeFileSync(join(dir, "scripts", "docs-check.mjs"), readFileSync(DOCS_CHECK));
      try {
        execFileSync(process.execPath, [join(dir, "scripts", "docs-check.mjs")], {
          cwd: dir,
          encoding: "utf8",
        });
        expect.unreachable("docs-check should have failed");
      } catch (err) {
        const e = err as { status?: number | null; stdout?: string; stderr?: string };
        expect(e.status).not.toBe(0);
        const msg = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        expect(msg).toMatch(/no-such-page/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
