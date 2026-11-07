/**
 * Copied from Herklos/Michel@402865d
 * Source: packages/core/src/command-floor.ts
 * Licence: Apache-2.0 (same as AnyBot)
 * Changes: import paths .js; relocated under floor/
 */

// The floor and the `auto` rules (docs/specs/approvals-broad.md). Pure string logic, so workflow code can use it.
//
// In `auto` and `full` an agent runs almost anything without asking. The floor is the short list that still does
// not run: an agent changing its own permissions, reading the owner's credentials, rewriting shared history,
// deleting outside its home, running a download, and writing the owner-reserved files. It is a guard against
// accidents and plain self-escalation, NOT a security boundary: a program the agent runs (`python -c`, a build
// script) can do anything its OS user can. The boundary is the operating system (the spec's section 5).
import {
  HARMLESS_REDIRECT,
  type Segment,
  SHELL_WRAPPER,
  splitCommand,
  unquoteWord,
} from "./command-policy.js";

/** What the node knows and the model does not. */
export interface FloorContext {
  /** The agent's home folder (canonical). Without it, only relative targets count as inside. */
  home?: string | undefined;
  /**
   * Single path segments, relative to the home, that the agent's harness reads as its own configuration (the harness
   * registry's `controlPaths`, sent by the node). `auto` asks a person before any write there. Absent: no such check.
   */
  controlPaths?: readonly string[] | undefined;
}

// Files that hold the owner's credentials or the hub's state. Matched on the basename or path of an argument.
const CREDENTIAL_PATHS = [
  /(?:^|\/)hub\.json$/,
  /(?:^|\/)michel\.db(?:-wal|-shm)?$/,
  /(?:^|\/)temporal\.db(?:-wal|-shm)?$/,
  /(?:^|\/)\.ssh(?:\/|$)/,
  /(?:^|\/)\.aws(?:\/|$)/,
  /(?:^|\/)\.config\/gh(?:\/|$)/,
  /(?:^|\/)\.codex\/auth/,
  /(?:^|\/)\.git-credentials$/,
  /(?:^|\/)\.netrc$/,
  /^\/proc\/[^/]+\/environ$/,
];
const SECRET_NAMES = /MICHEL_AGENT_SECRET|MICHEL_TOKEN|MICHEL_OWNER_TOKEN/;
// Files only the owner changes (AGENTS.md rules 9 and the vendored harness).
const RESERVED = [
  /(?:^|\/)vendor\/temporal-agent-harness(?:\/|$)/,
  /(?:^|\/)examples\/forge\/agents(?:\/|$)/,
];

/** Programs that only print or search text, so a credential path as an argument is not read by them. */
const TEXT_ONLY = new Set(["git", "grep", "rg", "ack", "echo", "printf"]);
const WRITERS = new Set([
  "tee",
  "cp",
  "mv",
  "rm",
  "install",
  "ln",
  "touch",
  "truncate",
  "dd",
  "patch",
  "rsync",
  "unlink",
]);
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
]);
/**
 * Temporal CLI verbs that change workflows (review round 6). Approvals reach the agent workflow as a Temporal update and
 * a local dev server has no authentication, so an agent running `temporal workflow update` could answer its own
 * approval. Reads (`describe`, `list`, `show`, `query`, `count`) and `server start-dev` stay open.
 */
const TEMPORAL_WRITES = new Set([
  "update",
  "signal",
  "signal-with-start",
  "terminate",
  "cancel",
  "reset",
  "delete",
  "start",
  "execute",
  "create",
  "pause",
  "unpause",
  "trigger",
  "backfill",
  "complete",
  "fail",
  "run",
]);
const TEMPORAL_CLI = /(?:^|\/)(?:temporal|tctl)$/;

function temporalReason(prog: string, args: string[]): string | undefined {
  let rest: string[] | undefined;
  if (prog === "temporal" || prog === "tctl") rest = args;
  else if (["pnpm", "npx", "bunx", "bun", "yarn"].includes(prog)) {
    const i = args.findIndex((a) => TEMPORAL_CLI.test(a));
    if (i >= 0) rest = args.slice(i + 1);
  }
  const verb = rest?.find((a) => TEMPORAL_WRITES.has(a));
  return verb
    ? `temporal ${verb} (changes workflows; approvals and runs are the owner's)`
    : undefined;
}

/** `michel` subcommands that only read. Anything else (allow, approve, post, agent, up, …) changes authority or state. */
const MICHEL_READ = new Set([
  "status",
  "tasks",
  "task",
  "messages",
  "approvals",
  "help",
  "version",
  "--help",
  "--version",
]);
const SYSTEM = new Set([
  "sudo",
  "su",
  "doas",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "systemctl",
  "service",
  "mount",
  "umount",
  "mkfs",
  "fdisk",
  "parted",
  "iptables",
  "crontab",
  "pkill",
  "killall",
]);
// `time` is a wrapper; `exec` is judged by askReason.
const WRAPPERS = new Set([
  "command",
  "builtin",
  "nohup",
  "time",
  "setsid",
  "stdbuf",
  "nice",
  "timeout",
  "xargs",
  "env",
  "ionice",
  "chronic",
]);

interface Parsed {
  prog: string;
  args: string[];
  /** `env` with nothing after it prints the environment. */
  bareEnv: boolean;
  /** Its operands come from `xargs`, so the call alone does not show them. */
  viaXargs?: boolean;
}

/** Splits on unquoted whitespace and drops the quote characters. No expansion is evaluated. */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < text.length) cur += text[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < text.length) {
      cur += text[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

const base = (w: string): string => (w.split("/").pop() ?? w).replace(/^\\/, "");

/** The program a simple command runs, after assignments and wrappers (`FOO=1 env -u X nice -n 5 /bin/rm -rf x`). */
function parseSimple(text: string): Parsed | undefined {
  let w = splitWords(text);
  const bareEnv = false;
  let viaXargs = false;
  for (let guard = 0; guard < 12; guard++) {
    while (w.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0] as string)) w = w.slice(1);
    if (w.length === 0) return undefined;
    const prog = base(w[0] as string);
    if (!WRAPPERS.has(prog))
      return { prog, args: w.slice(1), bareEnv, ...(viaXargs ? { viaXargs } : {}) };
    let rest = w.slice(1);
    if (prog === "env") {
      for (;;) {
        const a = rest[0];
        if (a === undefined) break;
        if (a === "-u" || a === "-C" || a === "-S") rest = rest.slice(2);
        else if (a.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) rest = rest.slice(1);
        else break;
      }
      if (rest.length === 0) return { prog: "env", args: [], bareEnv: true };
    } else if (prog === "nice") {
      if (rest[0] === "-n") rest = rest.slice(2);
      else if (rest[0]?.startsWith("-")) rest = rest.slice(1);
    } else if (prog === "timeout") {
      while (rest[0]?.startsWith("-"))
        rest = rest.slice(rest[0] === "-k" || rest[0] === "-s" ? 2 : 1);
      rest = rest.slice(1); // the duration
    } else if (prog === "xargs") {
      viaXargs = true;
      while (rest[0]?.startsWith("-"))
        rest = rest.slice(["-I", "-n", "-P", "-L", "-d", "-E", "-s"].includes(rest[0]) ? 2 : 1);
    } else {
      while (rest[0]?.startsWith("-")) rest = rest.slice(1);
    }
    w = rest;
  }
  return undefined;
}

/** Heredoc bodies are data. Drops them; returns undefined when a delimiter is never closed. */
function stripHeredocs(raw: string): string | undefined {
  if (!raw.includes("<<")) return raw;
  const lines = raw.split("\n");
  const out: string[] = [];
  let delim: string | null = null;
  for (const line of lines) {
    if (delim !== null) {
      if (line.trim() === delim) delim = null;
      continue;
    }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m) delim = m[2] as string;
  }
  return delim === null ? out.join("\n") : undefined;
}

/** Newlines outside quotes separate commands, as `;` does. */
function newlinesToSemicolons(s: string): string {
  let quote: string | null = null;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"') {
        out += c + (s[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
    } else if (c === "\\") {
      out += c + (s[i + 1] ?? "");
      i += 1;
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else out += c === "\n" ? ";" : c;
  }
  return out;
}

export interface Analysis {
  segs: Segment[];
  /** Targets of `>` and `>>` redirections, quotes removed. */
  redirects: string[];
  /** Why the line could not be read as a list of simple commands, if so. */
  unreadable?: string;
  /** The text the segments came from (shell wrapper removed, heredoc bodies dropped). */
  text: string;
}

/** Brings a command line to a list of simple commands, seeing inside `$( )`, backticks and `bash -lc '…'`. */
export function analyse(raw: string): Analysis {
  let text = raw.trim();
  for (let i = 0; i < 3; i++) {
    const m = SHELL_WRAPPER.exec(text);
    if (!m) break;
    const inner = unquoteWord((m[1] as string).trim());
    if (inner === undefined) break;
    text = inner.trim();
  }
  const noDoc = stripHeredocs(text);
  if (noDoc === undefined)
    return { segs: [], redirects: [], unreadable: "a here-document that never ends", text };
  text = noDoc;
  const redirects: string[] = [];
  const cleaned = text.replace(HARMLESS_REDIRECT, " ");
  for (const m of cleaned.matchAll(
    /(?:^|[^>&0-9])\d?>>?\s*(?!&)(?:"([^"]*)"|'([^']*)'|([^\s;&|<>()]+))/g,
  ))
    redirects.push((m[1] ?? m[2] ?? m[3]) as string);
  const flat = newlinesToSemicolons(cleaned)
    .replace(/\$\(/g, " §SUBST§ ; ")
    .replace(/<\(|>\(/g, ";")
    .replace(/`/g, ";");
  const segs = splitCommand(flat);
  if (!segs) return { segs: [], redirects, unreadable: "an unfinished quote", text };
  return { segs, redirects, text };
}

const homeRel = (t: string, home: string | undefined): boolean => {
  if (t.includes("..") || /[$`]/.test(t) || t.startsWith("~")) return false;
  if (!t.startsWith("/")) return true;
  if (/^\/tmp\/[^/]/.test(t) || t === "/dev/null") return true;
  return home !== undefined && t.startsWith(`${home}/`) && t.length > home.length + 1;
};

/** A target `rm -r`, `chmod -R` and the like may reach: inside the agent's home or /tmp, and never a bare `.`, `*` or `/`. */
function safeTarget(t: string, home: string | undefined): boolean {
  if (["", ".", "./", "*", "./*", ".*", "/", ".."].includes(t) || t.includes("§")) return false;
  return homeRel(t, home);
}

const hasFlag = (args: string[], long: RegExp, short: string): boolean =>
  args.some((a) => long.test(a) || (/^-[A-Za-z]+$/.test(a) && a.slice(1).includes(short)));
const nonOpts = (args: string[]): string[] => args.filter((a) => !a.startsWith("-"));

function gitReason(args: string[]): string | undefined {
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-")) {
    const a = args[i] as string;
    i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"].includes(a) ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  switch (sub) {
    case "push": {
      if (
        rest.some((a) =>
          /^--(force|force-with-lease|force-if-includes|delete|mirror|all|prune)(=|$)/.test(a),
        ) ||
        rest.some((a) => /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(a))
      )
        return "git push with force, delete, mirror or all";
      const refs = nonOpts(rest).slice(1);
      if (refs.length === 0) return "git push needs an explicit agent/<task> branch (never main)";
      for (const r of refs) {
        const dst = r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r;
        if (r.startsWith("+")) return "git push with a forced refspec";
        if (!/^(?:refs\/heads\/)?agent\/[\w./-]+$/.test(dst))
          return `git push to ${dst} (only agent/<task> branches)`;
      }
      return undefined;
    }
    case "reset":
      return rest.includes("--hard") ? "git reset --hard" : undefined;
    case "clean":
      return rest.some((a) => a === "-n" || a === "--dry-run") ? undefined : "git clean";
    case "branch": {
      if (
        !hasFlag(rest, /^--(delete|force)$/, "D") &&
        !hasFlag(rest, /^--delete$/, "d") &&
        !hasFlag(rest, /^--move$/, "M")
      )
        return undefined;
      const names = nonOpts(rest);
      return names.every((n) => n.startsWith("agent/")) && names.length > 0
        ? undefined
        : "git branch delete or move outside agent/*";
    }
    case "config":
      return rest.some((a) =>
        ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"].includes(a),
      )
        ? undefined
        : "git config write";
    case "filter-branch":
    case "filter-repo":
    case "update-ref":
      return `git ${sub}`;
    case "reflog":
      return rest.some((a) => a === "expire" || a === "delete")
        ? "git reflog expire/delete"
        : undefined;
    case "remote":
      return rest.some((a) => ["add", "set-url", "remove", "rm", "rename"].includes(a))
        ? "git remote change"
        : undefined;
    default:
      return undefined;
  }
}

function programReason(p: Parsed, ctx: FloorContext, hardOnly: boolean): string | undefined {
  const { prog, args } = p;
  const michelIdx =
    prog === "michel"
      ? 0
      : ["node", "pnpm", "npx", "bun", "tsx"].includes(prog)
        ? args.findIndex((a) => /(?:^|\/)michel(?:\.mjs)?$/.test(a))
        : -1;
  if (michelIdx >= 0) {
    const sub = args
      .slice(michelIdx + (prog === "michel" ? 0 : 1))
      .find((a) => !a.startsWith("-") || a === "--help" || a === "--version");
    if (!sub || !MICHEL_READ.has(sub))
      return `michel ${sub ?? ""} (the owner's command line; agents use their tools)`.replace(
        "  ",
        " ",
      );
  }
  const temporal = temporalReason(prog, args);
  if (temporal) return temporal;
  if (hardOnly) return undefined;
  if (SYSTEM.has(prog) || prog.startsWith("mkfs")) return `${prog} (system or process control)`;
  if (prog === "git") return gitReason(args);
  if (prog === "rm" || prog === "shred" || prog === "unlink") {
    if (args.includes("--no-preserve-root")) return "rm --no-preserve-root";
    if (
      prog === "rm" &&
      !hasFlag(args, /^--recursive$/, "r") &&
      !hasFlag(args, /^--recursive$/, "R")
    )
      return undefined;
    if (p.viaXargs) return `${prog} -r on operands from xargs`;
    const bad = nonOpts(args).find((t) => !safeTarget(t, ctx.home));
    return bad === undefined ? undefined : `${prog} -r on ${bad}, outside the agent's home`;
  }
  if (prog === "chmod" || prog === "chown" || prog === "chgrp") {
    if (!hasFlag(args, /^--recursive$/, "R")) return undefined;
    const bad = nonOpts(args)
      .slice(1)
      .find((t) => !safeTarget(t, ctx.home));
    return bad === undefined ? undefined : `${prog} -R on ${bad}, outside the agent's home`;
  }
  if (prog === "dd") {
    const of = args.find((a) => a.startsWith("of="))?.slice(3);
    return of !== undefined && !safeTarget(of, ctx.home) ? `dd of=${of}` : undefined;
  }
  if (
    prog === "find" &&
    (args.includes("-delete") ||
      args.some(
        (a, i) =>
          /^-exec(dir)?$/.test(a) && /^(rm|shred|chmod|chown)$/.test(base(args[i + 1] ?? "")),
      ))
  ) {
    const starts = [];
    for (const a of args) {
      if (a.startsWith("-") || a === "!" || a === "(") break;
      starts.push(a);
    }
    const bad = (starts.length ? starts : ["."]).find((t) => !safeTarget(t, ctx.home) && t !== ".");
    return bad === undefined ? undefined : `find -delete on ${bad}, outside the agent's home`;
  }
  return undefined;
}

function pathReason(t: string, prog: string, write: boolean): string | undefined {
  if (!TEXT_ONLY.has(prog) && CREDENTIAL_PATHS.some((re) => re.test(t)))
    return `${t} holds credentials or the hub's state`;
  if (write && RESERVED.some((re) => re.test(t)))
    return `${t} is owner-reserved (vendor/ and the agent templates)`;
  return undefined;
}

/** `env | grep -o '^(MICHEL|TEMPORAL)_[A-Z_]+'`, the idiom that strips those variables, prints names only. */
function namesOnly(next: Segment | undefined): boolean {
  const p = next?.sep === "|" ? parseSimple(next.text) : undefined;
  if (p?.prog !== "grep" || !hasFlag(p.args, /^--only-matching$/, "o")) return false;
  const pattern = nonOpts(p.args)[0] ?? "";
  return pattern !== "" && !/=|\.\*|\.\+/.test(pattern);
}

function scan(raw: string, ctx: FloorContext, hardOnly: boolean): string | undefined {
  const a = analyse(raw);
  if (
    !hardOnly &&
    /(?:^|[\s;&|(])(?:sh|bash|zsh|dash)\s+-[a-z]*c\b[^;&|]*(?:\$\(|`)\s*(?:curl|wget)\b/.test(
      a.text,
    )
  )
    return "running a downloaded script";
  let prevProg: string | undefined;
  for (const [i, seg] of a.segs.entries()) {
    const p = parseSimple(seg.text);
    if (!p) continue;
    if ((p.bareEnv || (p.prog === "printenv" && p.args.length === 0)) && !namesOnly(a.segs[i + 1]))
      return "printing the whole environment (it holds secrets)";
    if (
      !hardOnly &&
      seg.sep === "|" &&
      prevProg &&
      ["curl", "wget"].includes(prevProg) &&
      SHELLS.has(p.prog)
    )
      return "piping a download into a shell";
    prevProg = p.prog;
    const r = programReason(p, ctx, hardOnly);
    if (r) return r;
    for (const t of p.args) {
      if (SECRET_NAMES.test(t) && !["git", "grep", "rg"].includes(p.prog))
        return "the agent secret or a token";
      const pr = pathReason(
        t,
        p.prog,
        WRITERS.has(p.prog) || (p.prog === "sed" && hasFlag(p.args, /^--in-place/, "i")),
      );
      if (pr) return pr;
    }
  }
  for (const t of a.redirects) {
    const pr = pathReason(t, "redirect", true);
    if (pr) return pr;
  }
  return undefined;
}

/**
 * The part of the floor no allow-list overrides, in every mode: Michel's own command line, the owner's credentials and
 * the agent secret, printing the environment, and writes to the owner-reserved files. An allow-listed `cat` or `wc`
 * must not read `hub.json`. In `auto` and `full` this refuses; in `ask` a person decides.
 */
export function hardFloorReason(raw: string, ctx: FloorContext = {}): string | undefined {
  return scan(raw, ctx, true);
}

/**
 * Why a command line is refused in `auto` and `full`, or undefined: the hard floor plus history, destruction, system
 * and remote-code rules. An explicit `allow.commands` entry is judged before the soft part (the owner opted in to
 * that), and `ask` never calls it (a person decides).
 */
export function floorReason(raw: string, ctx: FloorContext = {}): string | undefined {
  return scan(raw, ctx, false);
}

/** `auto` asks a person for what it cannot read, or what writes outside the agent's home. Undefined: it may run. */
export function askReason(raw: string, ctx: FloorContext = {}): string | undefined {
  const a = analyse(raw);
  if (a.unreadable) return `cannot read the command (${a.unreadable})`;
  for (const seg of a.segs) {
    const p = parseSimple(seg.text);
    if (!p) continue;
    if (["eval", "source", ".", "exec"].includes(p.prog))
      return `${p.prog} runs text the command line does not show`;
  }
  const out = a.redirects.find((t) => !homeRel(t, ctx.home));
  if (out !== undefined) return `writes ${out}, outside the agent's home`;
  const controls = ctx.controlPaths ?? [];
  if (controls.length > 0) {
    // After a `cd` a relative target no longer starts at the home, so any segment naming a control path counts.
    const anywhere = a.segs.some((seg) =>
      ["cd", "pushd"].includes(parseSimple(seg.text)?.prog ?? ""),
    );
    const hit = (t: string) => controlTarget(t, ctx.home, controls, anywhere);
    for (const seg of a.segs) {
      const p = parseSimple(seg.text);
      if (!p) continue;
      const moves = ["cd", "pushd"].includes(p.prog);
      const writes =
        WRITERS.has(p.prog) || (p.prog === "sed" && hasFlag(p.args, /^--in-place/, "i"));
      if (!moves && !writes) continue;
      const target = nonOpts(p.args).find((t) =>
        moves ? controlTarget(t, ctx.home, controls, true) : hit(t),
      );
      if (target !== undefined)
        return `${moves ? "enters" : "writes"} ${target}, the harness's own configuration`;
    }
    const redirected = a.redirects.find(hit);
    if (redirected !== undefined) return `writes ${redirected}, the harness's own configuration`;
  }
  return undefined;
}

/** Whether a write target lands in one of the harness's control paths (home-relative first segment). */
function controlTarget(
  t: string,
  home: string | undefined,
  controls: readonly string[],
  anywhere: boolean,
): boolean {
  const parts = (s: string) => s.split("/").filter((x) => x !== "" && x !== ".");
  // A target the floor cannot place exactly (a `cd` before it, `..`, `~`, a variable) counts if any segment matches.
  if (anywhere || t.includes("..") || /[$`~]/.test(t))
    return parts(t).some((x) => controls.includes(x));
  let rel = t;
  if (t.startsWith("/")) {
    if (home === undefined || !t.startsWith(`${home}/`)) return false;
    rel = t.slice(home.length + 1);
  }
  const first = parts(rel)[0];
  return first !== undefined && controls.includes(first);
}

/** Owner-set extra refusals (`approvals.deny`): the first prefix that any simple command starts with. */
export function denyMatch(raw: string, prefixes: readonly string[]): string | undefined {
  if (prefixes.length === 0) return undefined;
  const a = analyse(raw);
  for (const seg of a.segs) {
    const p = parseSimple(seg.text);
    const norm = p ? [p.prog, ...p.args].join(" ") : seg.text;
    for (const pre of prefixes) {
      const hit = (t: string) =>
        pre.endsWith("/") ? t.startsWith(pre) : t === pre || t.startsWith(`${pre} `);
      if (hit(seg.text) || hit(norm)) return pre;
    }
  }
  return undefined;
}

const FILE_TOOLS: Record<string, { key: string; write: boolean }> = {
  Read: { key: "file_path", write: false },
  Edit: { key: "file_path", write: true },
  Write: { key: "file_path", write: true },
  NotebookEdit: { key: "notebook_path", write: true },
  Grep: { key: "path", write: false },
  Glob: { key: "path", write: false },
};

/** The floor for a file tool call: credentials, and for writes the owner-reserved files. */
export function fileFloorReason(toolName: string, rawInput: unknown): string | undefined {
  const spec = FILE_TOOLS[toolName];
  if (!spec || rawInput === null || typeof rawInput !== "object") return undefined;
  const p = (rawInput as Record<string, unknown>)[spec.key];
  if (typeof p !== "string") return undefined;
  return pathReason(p, toolName, spec.write);
}
