import { Permission } from "@opencode/core/permission"
import { ShellParse } from "@opencode/core/shell/parse"
import { Effect } from "effect"

// Redirections that write no file: descriptor duplication (`2>&1`, `>&2`) and discarding output to /dev/null.
const harmless = /\d*>&\d+|(?:\d*|&)>>?\s*\/dev\/null(?![^\s;|&])/g

/**
 * True when a set allows one shell command resource. The shell resource keeps its redirections, so `echo *` would
 * match `echo x > .git/hooks/pre-commit`; a set never allows a command that writes a file through redirection or runs
 * a process substitution, and that command asks as usual.
 */
export function covers(resource: string, resources: readonly string[]) {
  const rest = resource.replace(harmless, "")
  if (rest.includes(">") || rest.includes("<(")) return false
  return resources.some((pattern) => Permission.evaluate("shell", resource, [rule(pattern)]).effect === "allow")
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

function rule(resource: string): Permission.Rule {
  return { action: "shell", resource, effect: "allow" }
}
