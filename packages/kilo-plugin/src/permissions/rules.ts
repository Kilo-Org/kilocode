import { Permission } from "@opencode/core/permission"
import { ShellParse } from "@opencode/core/shell/parse"
import { ShellScan } from "@opencode/core/shell/scan"
import { Effect } from "effect"

// Redirections that write no file: descriptor duplication (`2>&1`, `>&2`) and discarding output to /dev/null.
const harmless = /\d*>&\d+|(?:\d*|&)>>?\s*\/dev\/null(?![^\s;|&])/g

/** Output helpers agents chain onto a check or install to trim or report its output. */
export const helpers = ["tail", "head", "grep", "echo", "ls"] as const

const helperPatterns = new Set<string>(helpers.map((helper) => `${helper} *`))
// Any expansion except the last exit status (`echo "exit code: $?"`) could print a variable or run a command.
const expansion = /`|\$(?!\?)/
// Options of head and tail that take their value as the next word.
const countOptions = new Set(["-n", "-c", "--lines", "--bytes"])
// grep options that only shape how input is matched or printed. Everything else asks: recursion, pattern or exclude
// files, directory and device actions, and abbreviated long options, which GNU grep expands (`--fil` is `--file`).
const grepSafeFlags = /^[iyvwxcoqsnbHhEFGPaTUZzlLemABC]+$/
const grepSafeOptions = new Set([
  "--ignore-case",
  "--no-ignore-case",
  "--invert-match",
  "--word-regexp",
  "--line-regexp",
  "--count",
  "--only-matching",
  "--quiet",
  "--silent",
  "--no-messages",
  "--line-number",
  "--byte-offset",
  "--with-filename",
  "--no-filename",
  "--label",
  "--color",
  "--colour",
  "--extended-regexp",
  "--fixed-strings",
  "--basic-regexp",
  "--perl-regexp",
  "--text",
  "--binary-files",
  "--null",
  "--null-data",
  "--line-buffered",
  "--initial-tab",
  "--files-with-matches",
  "--files-without-match",
  "--regexp",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
])
// grep short options whose value is the rest of the word or the next word.
const grepValueFlags = "emABC"
const grepValueOptions = new Set([
  "--regexp",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
  "--label",
  "--binary-files",
])
// Package-manager and runtime options that move the command to another directory, workspace or global prefix, load
// other config, or run another program (`npm run test --prefix /elsewhere`, `--script-shell`, `bun --preload`).
// npm and GNU-style parsers expand abbreviations, so any prefix of one of these names asks too.
const projectEscapeOptions = [
  "prefix",
  "cwd",
  "dir",
  "workspace",
  "workspaces",
  "ws",
  "include-workspace-root",
  "workspace-root",
  "filter",
  "filter-prod",
  "recursive",
  "global",
  "global-dir",
  "global-folder",
  "location",
  "userconfig",
  "globalconfig",
  "config",
  "script-shell",
  "shell",
  "node-options",
  "preload",
  "require",
  "import",
  "eval",
  "print",
  "registry",
  "git",
  "cache",
  "cache-folder",
  "modules-folder",
  "store-dir",
  "virtual-store-dir",
]
// Their short forms: -C (prefix/dir), -w (workspace), -g (global), -F (filter), -r (recursive/preload), -c (config),
// -e and -p (eval/print).
const projectEscapeFlags = /[CwgFrcep]/

/**
 * True when a set allows one shell command resource. The shell resource keeps its redirections, so `echo *` would
 * match `echo x > .git/hooks/pre-commit`; a set never allows a command that writes or reads a file through
 * redirection, runs a process substitution or reads a here-document, and that command asks as usual. The output
 * helpers only match forms that read no file and expand nothing (see `safeHelper`), so `head .env`,
 * `head < .env` or `echo $API_KEY` still ask.
 */
export function covers(resource: string, resources: readonly string[]) {
  const rest = resource.replace(harmless, "")
  if (rest.includes(">") || rest.includes("<")) return false
  return resources.some(
    (pattern) =>
      Permission.evaluate("shell", resource, [rule(pattern)]).effect === "allow" &&
      (helperPatterns.has(pattern) ? safeHelper(resource) : staysInProject(resource)),
  )
}

/** True when every resource of a request is already allowed by the evaluated rules or by the applied sets. */
export function allowsRequest(input: {
  readonly action: string
  readonly resources: readonly string[]
  readonly rules: Permission.Ruleset
  readonly applied: readonly string[]
}) {
  return input.resources.every(
    (resource) =>
      Permission.evaluate(input.action, resource, input.rules).effect === "allow" || covers(resource, input.applied),
  )
}

/** The parts of a command a set does not allow, as the shell tool would ask for them. */
export function missing(command: string, directory: string, resources: readonly string[]) {
  return ShellParse.scan(command, "bash", directory).pipe(
    Effect.map((parsed) =>
      parsed.commands.map((item) => item.resource).filter((resource) => !covers(resource, resources)),
    ),
    // A command the scanner cannot analyze asks as a whole.
    Effect.catch((error) => Effect.succeed([`${command} (${error.message})`])),
  )
}

/**
 * True when an output helper only works on its input: head, tail and grep name no file, grep uses only options that
 * shape matching or output (no recursion, pattern or exclude file), and no word expands a variable or a command. ls may
 * still list any directory.
 */
function safeHelper(resource: string) {
  const scanned = ShellScan.scan(resource, "bash")
  if (scanned.kind === "opaque" || scanned.commands.length !== 1) return false
  const command = scanned.commands[0]!
  if (command.rawWords.some((word) => expansion.test(word))) return false
  const args = command.words.slice(1)
  if (command.words[0] === "head" || command.words[0] === "tail") return countArgs(args)
  if (command.words[0] === "grep") return grepArgs(args)
  return command.words[0] === "echo" || command.words[0] === "ls"
}

/**
 * True when a project script or install runs in this project: no expansion, and no option before `--` that points it
 * at another directory, workspace, config or program. Arguments after `--` go to the script itself.
 */
function staysInProject(resource: string) {
  const scanned = ShellScan.scan(resource, "bash")
  if (scanned.kind === "opaque" || scanned.commands.length !== 1) return false
  const command = scanned.commands[0]!
  if (command.rawWords.some((word) => expansion.test(word))) return false
  const end = command.words.indexOf("--")
  return command.words
    .slice(1, end === -1 ? undefined : end)
    .every((arg) => !escapesProject(arg))
}

function escapesProject(arg: string) {
  if (arg.startsWith("--")) {
    const name = arg.slice(2).split("=")[0]!
    return projectEscapeOptions.some(
      (option) => option.startsWith(name) || name.startsWith(`${option}.`) || name.startsWith(`${option}:`),
    )
  }
  return arg.startsWith("-") && projectEscapeFlags.test(arg.slice(1))
}

// `tail -30`, `tail -n 30`, `head --lines=5`: options and their counts only, never a file operand.
function countArgs(args: readonly string[]) {
  return args.every(
    (arg, index) => arg.startsWith("-") || (countOptions.has(args[index - 1] ?? "") && /^[+-]?\d+[a-zA-Z]*$/.test(arg)),
  )
}

// `grep -iE "error|warn"` or `grep -e foo`: a pattern but no file operand, recursion or pattern file.
function grepArgs(args: readonly string[]) {
  const state = { positional: 0, explicit: false, value: false }
  for (const arg of args) {
    if (state.value) {
      state.value = false
      continue
    }
    if (arg === "--") return false
    if (arg.startsWith("--")) {
      if (!grepLongOption(arg, state)) return false
      continue
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (!grepShortOptions(arg.slice(1), state)) return false
      continue
    }
    state.positional++
  }
  return state.positional <= (state.explicit ? 0 : 1)
}

function grepLongOption(arg: string, state: { explicit: boolean; value: boolean }) {
  const name = arg.split("=")[0]!
  if (!grepSafeOptions.has(name)) return false
  if (name === "--regexp") state.explicit = true
  state.value = grepValueOptions.has(name) && !arg.includes("=")
  return true
}

function grepShortOptions(flags: string, state: { explicit: boolean; value: boolean }) {
  const index = [...flags].findIndex((flag) => grepValueFlags.includes(flag))
  const options = index === -1 ? flags : flags.slice(0, index + 1)
  if (!grepSafeFlags.test(options)) return false
  if (index !== -1 && flags[index] === "e") state.explicit = true
  state.value = index === flags.length - 1
  return true
}

function rule(resource: string): Permission.Rule {
  return { action: "shell", resource, effect: "allow" }
}
