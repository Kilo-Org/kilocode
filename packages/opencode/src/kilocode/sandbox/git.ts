const READONLY = new Set([
  "cat-file",
  "check-attr",
  "check-ignore",
  "check-mailmap",
  "config",
  "describe",
  "diff",
  "for-each-ref",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "merge-base",
  "name-rev",
  "rev-list",
  "rev-parse",
  "show",
  "show-ref",
  "status",
  "tag",
  "whatchanged",
])

const MUTATING = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "cherry-pick",
  "checkout",
  "clean",
  "clone",
  "commit",
  "fetch",
  "init",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "rm",
  "stash",
  "switch",
  "update-index",
])

function args(text: string) {
  const match = text
    .trim()
    .match(
      /^(?:command\s+|env\s+(?:-[^\s]+\s+|[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*|[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:git|git.exe)(?:\s+|$)(.*)$/i,
    )
  if (!match) return
  return match[1].trim().split(/\s+/).filter(Boolean)
}

export function mutates(text: string) {
  if (/[;&|<>`\n\r]/.test(text)) return false
  const values = args(text)
  if (!values) return false
  const options = new Set(["-C", "--git-dir", "--work-tree", "--namespace", "-c"])
  while (values[0]?.startsWith("-")) {
    const option = values.shift()!
    if (options.has(option)) values.shift()
  }
  const subcommand = values[0]?.toLowerCase()
  if (!subcommand) return false
  if (subcommand === "branch") {
    return (
      values.length > 1 &&
      !values
        .slice(1)
        .some((value) =>
          ["-a", "-r", "-l", "--all", "--list", "--show-current", "--contains", "--merged", "--no-merged"].includes(
            value,
          ),
        )
    )
  }
  if (subcommand === "tag") {
    return (
      values.length > 1 &&
      !values
        .slice(1)
        .some((value) => ["-l", "--list", "--contains", "--points-at", "--merged", "--no-merged"].includes(value))
    )
  }
  if (subcommand === "config") {
    if (values.length === 1) return false
    return !values
      .slice(1)
      .some((value) =>
        [
          "--get",
          "--get-all",
          "--get-regexp",
          "--get-urlmatch",
          "--list",
          "-l",
          "--name-only",
          "--show-origin",
          "--show-names",
        ].includes(value),
      )
  }
  if (READONLY.has(subcommand)) return false
  if (MUTATING.has(subcommand)) return true
  return true
}
