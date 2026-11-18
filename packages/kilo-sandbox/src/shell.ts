import type { Launch } from "./backend"

export interface Command {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Resolves the command line a launch runs, wrapping a shell launch the way every backend must. */
export function shellCommand(launch: Launch): Command {
  if (!launch.shell) return { command: launch.command, args: launch.args }
  const shell = typeof launch.shell === "string" ? launch.shell : "/bin/sh"
  return { command: shell, args: ["-c", [launch.command, ...launch.args.map(quote)].join(" ")] }
}
