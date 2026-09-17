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
  "switch",
  "update-index",
])

const BRANCH_READ = new Set([
  "-a",
  "-l",
  "-r",
  "-v",
  "-vv",
  "--all",
  "--column",
  "--contains",
  "--format",
  "--list",
  "--merged",
  "--no-merged",
  "--points-at",
  "--remotes",
  "--show-current",
  "--sort",
  "--verbose",
])

const TAG_READ = new Set([
  "-l",
  "-n",
  "-v",
  "--column",
  "--contains",
  "--format",
  "--list",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--verbose",
])

const BRANCH_WRITE = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "-c",
  "-C",
  "-u",
  "--delete",
  "--move",
  "--copy",
  "--set-upstream-to",
  "--unset-upstream",
  "--edit-description",
])

const TAG_WRITE = new Set([
  "-d",
  "--delete",
  "-a",
  "--annotate",
  "-s",
  "--sign",
  "-f",
  "--force",
  "-F",
  "--file",
  "-m",
  "--message",
])

const REMOTE_READ = new Set(["get-url", "show"])
const REMOTE_FLAGS = new Set(["-v", "--verbose"])
const STASH_READ = new Set(["list", "show"])
const REFLOG_READ = new Set(["exists", "show"])
const NOTES_READ = new Set(["get-ref", "list", "show"])
const VALUE_FLAGS = new Set(["-m", "--message", "--ref"])

function flags(values: string[]) {
  return values.slice(1).flatMap((value) => {
    if (value.startsWith("--")) return [value.split("=").at(0) ?? value]
    if (value.startsWith("-") && value.length > 2)
      return value
        .slice(1)
        .split("")
        .map((char) => `-${char}`)
    return [value]
  })
}

function verb(values: string[], index = 1): string | undefined {
  const value = values[index]
  if (!value) return
  if (!value.startsWith("-")) return value
  if (value.startsWith("--") && value.includes("=")) return verb(values, index + 1)
  return verb(values, VALUE_FLAGS.has(value) ? index + 2 : index + 1)
}

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
    const parts = flags(values)
    if (parts.some((value) => BRANCH_WRITE.has(value))) return true
    if (parts.some((value) => BRANCH_READ.has(value))) return false
    return parts.some((value) => !value.startsWith("-"))
  }
  if (subcommand === "tag") {
    const parts = flags(values)
    if (parts.some((value) => TAG_WRITE.has(value))) return true
    if (parts.some((value) => TAG_READ.has(value))) return false
    return parts.some((value) => !value.startsWith("-"))
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
  if (subcommand === "remote") {
    if (values.length === 1) return false
    const name = verb(values)
    if (name) return !REMOTE_READ.has(name)
    return values.slice(1).some((value) => !REMOTE_FLAGS.has(value))
  }
  if (subcommand === "stash") {
    const name = verb(values)
    if (!name) return true
    return !STASH_READ.has(name)
  }
  if (subcommand === "worktree") {
    return verb(values) !== "list"
  }
  if (subcommand === "reflog") {
    const name = verb(values)
    if (!name) return false
    return !REFLOG_READ.has(name)
  }
  if (subcommand === "notes") {
    const name = verb(values)
    if (!name) return false
    return !NOTES_READ.has(name)
  }
  if (READONLY.has(subcommand)) return false
  if (MUTATING.has(subcommand)) return true
  return true
}
