/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/core/src/command-policy.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; relocated under floor/
 */

// Which shell commands may run without asking a person. Deliberately conservative: a command is allowed
// only if every simple command in it starts with an allowed prefix AND it uses nothing that can hide
// another command (substitution, redirection to a file, backgrounding, here-documents).

/** Characters and forms that make a command line unsafe to reason about by prefix. */
// Options that turn an innocent-looking git command into a way to read or write arbitrary files or run a program.
const GIT_RISKY = [
  /--no-index/,
  /--output/,
  /--ext-diff/,
  /--textconv/,
  /--exec/,
  /--upload-pack/,
  /--receive-pack/,
  // `git -c core.pager=...` (any inline config) and `--config-env` run programs; matching "core." anywhere
  // also refused package filters such as `--filter @michel/core...`.
  /\bgit\b[^;&|]*\s(?:-c|--config-env)/,
  /--git-dir/,
  /--work-tree/,
  /--open-files-in-pager/,
  /\s-O\b/,
];
const UNSAFE = [
  ...GIT_RISKY,
  /\$\(/,
  /`/,
  /<\(/,
  />\(/,
  /<</,
  /\\$/,
  /\$\{/,
  /\beval\b/,
  /\bsource\b/,
  /\bexec\b/,
];

export interface Segment {
  text: string;
  /** The operator in front of this segment: "" for the first, otherwise "|", "||", "&&" or ";". */
  sep: string;
}

export function splitCommand(command: string): Segment[] | undefined {
  // Quotes are followed as the shell does: an operator inside quotes is text. (A program that re-reads its
  // arguments as shell is as powerful with unquoted arguments; that is a property of the prefix the owner
  // allowed, not of the quoting.)
  const out: Segment[] = [];
  let cur = "";
  let sep = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"') {
        cur += c + (command[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === "\\") {
      // Outside quotes a backslash makes the next character plain text, as in the shell.
      cur += c + (command[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === "\n") return undefined; // a newline outside quotes starts another command
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    // Plain grouping `( a && b )` is only grouping: every command inside still has to match on its own.
    // (`$(`, `<(` and `>(` were refused earlier.)
    if (c === "(" || c === ")") {
      out.push({ text: cur.trim(), sep });
      cur = "";
      sep = sep || "";
      continue;
    }
    if (c === ";" || c === "|" || c === "&") {
      let op = c;
      if ((c === "&" || c === "|") && command[i + 1] === c) {
        op = c + c;
        i += 1;
      }
      out.push({ text: cur.trim(), sep });
      cur = "";
      sep = op;
      continue;
    }
    cur += c;
  }
  if (quote) return undefined;
  out.push({ text: cur.trim(), sep });
  return out.filter((x) => x.text.length > 0);
}

/**
 * `prefixes` match whole words: "git status" allows `git status -s` but not `git statusx`; a prefix ending in
 * "/" (for example "node scripts/") allows anything under it.
 */
/** Redirections that only discard output or merge stderr into stdout; they cannot write a file. */
export const HARMLESS_REDIRECT = /(?:&>|\d?>)\s*\/dev\/null(?=\s|;|&|\||$)|\d>&\d(?=\s|;|&|\||$)/g;
/** Filters that only read the pipe: allowed as the receiving end of a pipe when given no file operands. */
const PIPE_SINKS = new Set(["tail", "head", "wc", "sort", "uniq", "cut"]);
// `-n`, `-5`, and cut's `-c1-40` / `-f1,3`: options and numbers only, never a file name.
const FLAG_ONLY = /^(?:-[A-Za-z0-9]+(?:[-,]\d+)*|-?\d+)$/;

/** `bash -lc WORD`, the way Codex runs every command: the shell, `-c` or `-lc`, and one quoted word. */
export const SHELL_WRAPPER = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+(\S[\s\S]*)$/;

/**
 * The value of a single shell word made of quoted pieces and plain characters (`"a '"'b'"' c"`), or undefined
 * when the word needs the shell to expand something: `$`, backticks or a backslash inside double quotes, or an
 * unquoted character outside a small safe set.
 */
export function unquoteWord(word: string): string | undefined {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const c = word[i] as string;
    if (c === "'") {
      const end = word.indexOf("'", i + 1);
      if (end < 0) return undefined;
      out += word.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < word.length && word[j] !== '"') {
        if (word[j] === "$" || word[j] === "`" || word[j] === "\\") return undefined;
        j += 1;
      }
      if (j >= word.length) return undefined;
      out += word.slice(i + 1, j);
      i = j;
    } else if (/[A-Za-z0-9_./:=@%+,-]/.test(c)) {
      out += c;
    } else return undefined;
  }
  return out;
}

export function commandAllowed(rawCommand: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return false;
  // Codex asks to run `/bin/bash -lc '<command>'`; the allow-list is about the command inside.
  const wrapped = SHELL_WRAPPER.exec(rawCommand.trim());
  if (wrapped) {
    const inner = unquoteWord((wrapped[1] as string).trim());
    return (
      inner !== undefined && !SHELL_WRAPPER.test(inner.trim()) && commandAllowed(inner, prefixes)
    );
  }
  const command = rawCommand.replace(HARMLESS_REDIRECT, " ");
  if (UNSAFE.some((re) => re.test(command))) return false;
  if (hasLooseOperator(command)) return false;
  const segs = splitCommand(command);
  if (!segs || segs.length === 0) return false;
  return segs.every((seg) => {
    if (seg.sep === "|" && isPipeSink(seg.text)) return true;
    return prefixes.some((p) =>
      p.endsWith("/") ? seg.text.startsWith(p) : seg.text === p || seg.text.startsWith(`${p} `),
    );
  });
}

/**
 * A `>` writes a file and a lone `&` starts a background job, unless the shell reads them as text: inside
 * quotes (an e-mail address or a semicolon in a commit message) or escaped. The scan follows the shell: no
 * escapes inside single quotes, `\x` escapes in double quotes and outside quotes. An unterminated quote
 * counts as unsafe.
 */
function hasLooseOperator(command: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "\\") i += 1;
    else if (c === "'" || c === '"') quote = c;
    else if (c === ">") return true;
    else if (c === "&" && command[i + 1] !== "&" && command[i - 1] !== "&") return true;
  }
  return quote !== null;
}

/** A read-only filter whose arguments are only flags and numbers (so it reads the pipe, never a file). */
function isPipeSink(text: string): boolean {
  const words = text.split(/\s+/);
  return PIPE_SINKS.has(words[0] ?? "") && words.slice(1).every((w) => FLAG_ONLY.test(w));
}
