// kilocode_change - Action gate: deterministic tripwires that block dangerous tool actions before
// they run, regardless of why the agent chose them (careless overreach = threat class #1, or
// prompt injection = class #3). This is NOT a probabilistic guardrail: a matched tripwire cannot be
// talked out of it, which is what the case card's "at least one control architecturally immune to
// prompt injection" requirement asks for.
//
// First tripwire: destructive `rm -rf` targeting a critical path (filesystem root, home, a top-level
// directory, or the workspace/cwd itself or any parent of it). `rm -rf build/` inside the project is
// allowed. Command tokens come from the shell tree-sitter parser (never a regex over the raw string);
// path targets are resolved against the effective cwd by the caller. A destructive rm whose target
// cannot be resolved (e.g. `$HOME`, `$PWD`, globs) FAILS CLOSED — it is blocked, not silently allowed.
import os from "node:os"
import path from "node:path"

/** Opt-in via env so the gate is inert until explicitly enabled. */
export const enabled = process.env["KILO_ACTION_GATE"] === "1"

export type Verdict = { readonly block: false } | { readonly block: true; readonly reason: string }

const ALLOW: Verdict = { block: false }

/** Matches `rm`, `/bin/rm`, `/usr/bin/rm`, etc. — the invocation name regardless of its path. */
export function isRmInvocation(commandName: string): boolean {
  const base = commandName.split("/").pop() ?? commandName
  return base === "rm"
}

/**
 * Pure token analysis of one command. Returns whether it is a destructive rm (recursive AND force)
 * and the raw path arguments. Handles combined short flags (`-rf`, `-fr`), `-R`, long flags
 * (`--recursive`, `--force`), and the `--` end-of-flags separator (everything after `--` is a path).
 */
// Peel a few SIMPLE command wrappers so `sudo rm -rf /`, `command rm -rf /`, `env rm -rf /` and
// `env FOO=bar rm -rf /` are recognised as rm. Deliberately narrow: any wrapper carrying its own
// options (`sudo -u x`, `env -i`, `command -v`) is left as-is and NOT peeled -- those complex forms
// are a documented limitation, not silently mis-handled. `env echo ...` peels to `echo`, so a
// non-rm payload behind env is correctly left alone.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
export function peelWrappers(tokens: readonly string[]): string[] {
  let toks = tokens.slice()
  for (let guard = 0; guard < 4 && toks.length > 1; guard++) {
    const head = toks[0]
    if (head === "sudo" || head === "command") {
      if (toks[1]!.startsWith("-")) break // options present -> complex form, leave as-is
      toks = toks.slice(1)
      continue
    }
    if (head === "env") {
      let i = 1
      while (i < toks.length && ASSIGNMENT.test(toks[i]!)) i++
      if (i >= toks.length || toks[i]!.startsWith("-")) break // env option or nothing left -> leave
      toks = toks.slice(i)
      continue
    }
    break
  }
  return toks
}

export function analyzeRm(rawTokens: readonly string[]): { destructive: boolean; paths: string[] } {
  const tokens = peelWrappers(rawTokens)
  if (tokens.length === 0 || !isRmInvocation(tokens[0]!)) return { destructive: false, paths: [] }
  let recursive = false
  let force = false
  let endOfFlags = false
  const paths: string[] = []
  for (const token of tokens.slice(1)) {
    if (!endOfFlags && token === "--") {
      endOfFlags = true
      continue
    }
    if (!endOfFlags && token.length > 1 && token.startsWith("-")) {
      if (token.startsWith("--")) {
        if (token === "--recursive") recursive = true
        else if (token === "--force") force = true
        // other long flags are irrelevant to this tripwire
      } else {
        if (token.includes("r") || token.includes("R")) recursive = true
        if (token.includes("f")) force = true
      }
      continue
    }
    paths.push(token)
  }
  return { destructive: recursive && force, paths }
}

/** True when deleting `target` would destroy `base` (target is `base` itself or an ancestor of it). */
function destroys(target: string, base: string): boolean {
  const rel = path.relative(target, base)
  if (rel === "") return true // same path
  if (path.isAbsolute(rel)) return false // different volumes / escapes
  if (rel === ".." || rel.startsWith(".." + path.sep)) return false // base is OUTSIDE target
  return true // rel is a forward path -> target is an ancestor of base
}

/** Deterministic critical-path test for a resolved absolute path. */
export function isCriticalPath(resolved: string, cwd: string, instanceDir: string): boolean {
  const p = path.resolve(resolved)
  const root = path.parse(p).root
  if (p === root) return true // filesystem root, e.g. "/"
  if (p === path.resolve(os.homedir())) return true // home directory
  if (path.dirname(p) === root) return true // top-level directory, e.g. "/usr", "/etc"
  // The workspace/cwd itself, or any parent of it: deleting these takes out the project or more.
  for (const base of [cwd, instanceDir]) {
    if (!base) continue
    if (destroys(p, path.resolve(base))) return true
  }
  return false
}

export interface RmTarget {
  /** The raw argument as written by the agent, for the block reason. */
  readonly raw: string
  /** The path resolved against the effective cwd, or undefined if it could not be resolved. */
  readonly resolved: string | undefined
}

/**
 * First tripwire. `targets` are the path arguments of a destructive rm (recursive+force, confirmed by
 * the caller via {@link analyzeRm}). Blocks if any target is a critical path, OR if any target could
 * not be resolved (fail closed: a dynamic `$HOME`/`$PWD`/glob under `rm -rf` is treated as dangerous).
 */
export function checkDestructiveRm(targets: readonly RmTarget[], cwd: string, instanceDir: string): Verdict {
  for (const target of targets) {
    if (target.resolved === undefined) {
      return {
        block: true,
        reason: `Blocked destructive recursive delete with an unresolved target "${target.raw}". Dynamic targets (like $HOME, $PWD, or globs) are not allowed under "rm -rf"; name a concrete subdirectory inside the project instead.`,
      }
    }
    if (isCriticalPath(target.resolved, cwd, instanceDir)) {
      return {
        block: true,
        reason: `Blocked destructive recursive delete of a critical path: "${target.raw}" (resolves to ${path.resolve(
          target.resolved,
        )}). Narrow the target to a specific subdirectory inside the project instead.`,
      }
    }
  }
  return ALLOW
}
