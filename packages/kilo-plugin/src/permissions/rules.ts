import { Permission } from "@opencode/core/permission"
import { ShellParse } from "@opencode/core/shell/parse"
import { ShellScan } from "@opencode/core/shell/scan"
import { Effect } from "effect"
import os from "os"
import path from "path"

// Redirections that write no file: descriptor duplication (`2>&1`, `>&2`) and discarding output to /dev/null.
const harmless = /\d*>&\d+|(?:\d*|&)>>?\s*\/dev\/null(?![^\s;|&])/g

// Any expansion could print a variable, run a command or name a path the set cannot check.
const expansion = /`|\$/
// Install subcommands a set allows only without a package argument, so they install from the lockfile. `add` always
// names a package; it is listed so a set stored before `add` left the install set still asks.
const installPattern = /^(?:bun|npm|pnpm|yarn) (?:install|i|ci|add) \*$/
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
 * True when a set allows one shell command resource. The shell resource keeps its redirections, so `bun run test *`
 * would match `bun run test > .git/hooks/pre-commit`; a set never allows a command that writes or reads a file through
 * redirection, runs a process substitution or reads a here-document, and that command asks as usual. A covered
 * command must also stay in the project (see `staysInProject`), and an install must name no package (see
 * `lockfileInstall`).
 */
export function covers(resource: string, resources: readonly string[], directory: string) {
  const rest = resource.replace(harmless, "")
  if (rest.includes(">") || rest.includes("<")) return false
  return resources.some(
    (pattern) =>
      Permission.evaluate("shell", resource, [rule(pattern)]).effect === "allow" &&
      staysInProject(resource, directory) &&
      (!installPattern.test(pattern) || lockfileInstall(resource)),
  )
}

/** True when every resource of a request is already allowed by the evaluated rules or by the applied sets. */
export function allowsRequest(input: {
  readonly action: string
  readonly resources: readonly string[]
  readonly rules: Permission.Ruleset
  readonly applied: readonly string[]
  readonly directory: string
}) {
  return input.resources.every(
    (resource) =>
      Permission.evaluate(input.action, resource, input.rules).effect === "allow" ||
      covers(resource, input.applied, input.directory),
  )
}

/** The parts of a command a set does not allow, as the shell tool would ask for them. */
export function missing(command: string, directory: string, resources: readonly string[]) {
  return ShellParse.scan(command, "bash", directory).pipe(
    Effect.map((parsed) =>
      parsed.commands.map((item) => item.resource).filter((resource) => !covers(resource, resources, directory)),
    ),
    // A command the scanner cannot analyze asks as a whole.
    Effect.catch((error) => Effect.succeed([`${command} (${error.message})`])),
  )
}

/**
 * True when a project script or install runs in this project: no expansion, no option before `--` that points it at
 * another directory, workspace, config or program, and no path before `--` that resolves outside the project
 * (`bun test /tmp/evil.test.ts`, `bun run test ../other-repo`). Arguments after `--` go to the script itself. The
 * request does not carry the command's working directory, so paths resolve against the project root.
 */
function staysInProject(resource: string, directory: string) {
  const command = scanOne(resource)
  if (command === undefined) return false
  const end = command.words.indexOf("--")
  return command.words
    .slice(1, end === -1 ? undefined : end)
    .every((arg) => !escapesProject(arg) && insideProject(arg, directory))
}

// `bun install`, `npm ci --omit=dev`: options only, never a package, URL or tarball. An option whose value is the next
// word (`--omit dev`) asks too, since that word looks like a package.
function lockfileInstall(resource: string) {
  const command = scanOne(resource)
  return command !== undefined && command.words.slice(2).every((arg) => arg.startsWith("-"))
}

function scanOne(resource: string) {
  const scanned = ShellScan.scan(resource, "bash")
  if (scanned.kind === "opaque" || scanned.commands.length !== 1) return
  const command = scanned.commands[0]!
  if (command.rawWords.some((word) => expansion.test(word))) return
  return command
}

// A positional argument, or the value of `--option=value`, that looks like a path must resolve inside the project.
function insideProject(arg: string, directory: string) {
  if (arg.startsWith("-") && !arg.includes("=")) return true
  const value = arg.startsWith("-") ? arg.slice(arg.indexOf("=") + 1) : arg
  if (!pathLike(value)) return true
  const resolved = path.resolve(directory, value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value)
  const relative = path.relative(directory, resolved)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function pathLike(value: string) {
  return value.includes("/") || value.startsWith("~") || value === "." || value === ".."
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

function rule(resource: string): Permission.Rule {
  return { action: "shell", resource, effect: "allow" }
}
