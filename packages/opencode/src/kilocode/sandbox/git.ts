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

const BRANCH_WRITE = new Set([
  "-c",
  "-C",
  "-d",
  "-D",
  "-f",
  "-m",
  "-M",
  "-t",
  "-u",
  "--copy",
  "--create-reflog",
  "--delete",
  "--edit-description",
  "--force",
  "--move",
  "--set-upstream",
  "--set-upstream-to",
  "--track",
  "--unset-upstream",
])

const BRANCH_READ = new Set([
  "-a",
  "-l",
  "-r",
  "-v",
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

const BRANCH_CONSUME = new Set(["--contains", "--format", "--merged", "--no-merged", "--points-at", "--sort"])
const BRANCH_PATTERN = new Set(["-l", "--list"])

const TAG_WRITE = new Set([
  "-F",
  "-a",
  "-d",
  "-e",
  "-f",
  "-m",
  "-s",
  "-u",
  "--annotate",
  "--cleanup",
  "--create-reflog",
  "--delete",
  "--edit",
  "--file",
  "--force",
  "--local-user",
  "--message",
  "--sign",
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
  "--verify",
])

const TAG_CONSUME = new Set([
  "-v",
  "--contains",
  "--format",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--verify",
])
const TAG_PATTERN = new Set(["-l", "-n", "--list"])

const REMOTE_READ = new Set(["get-url", "show"])
const REMOTE_FLAGS = new Set(["-v", "--verbose"])
const STASH_READ = new Set(["list", "show"])
const REFLOG_READ = new Set(["exists", "show"])
const NOTES_READ = new Set(["get-ref", "list", "show"])
const NOTES_FLAGS = new Set(["--ref"])

function flag(value: string) {
  return value.split("=")[0]
}

function expand(values: string[]) {
  return values.flatMap((value) => {
    if (/^-[A-Za-z]{2,}\d*$/.test(value))
      return value
        .slice(1)
        .replace(/\d+$/, "")
        .split("")
        .map((char) => `-${char}`)
    if (/^-[A-Za-z]\d+$/.test(value)) return [value.slice(0, 2)]
    return [value]
  })
}

function strip(values: string[], consume: Set<string>) {
  const out: string[] = []
  let skip = false
  for (const value of values) {
    if (skip) {
      skip = false
      continue
    }
    out.push(value)
    skip = consume.has(flag(value)) && !value.includes("=")
  }
  return out
}

function scan(values: string[], write: Set<string>, read: Set<string>, consume: Set<string>, pattern: Set<string>) {
  if (values.length === 1) return false
  const tokens = expand(values.slice(1))
  if (tokens.some((token) => write.has(flag(token)))) return true
  const rest = strip(tokens, consume)
  if (!rest.some((token) => read.has(flag(token)))) return true
  if (rest.some((token) => pattern.has(flag(token)))) return false
  return rest.some((token) => !token.startsWith("-"))
}

function verb(values: string[], takes: Set<string> = new Set()) {
  let skip = false
  for (const value of values.slice(1)) {
    if (skip) {
      skip = false
      continue
    }
    if (value.startsWith("-")) {
      skip = takes.has(flag(value)) && !value.includes("=")
      continue
    }
    return value
  }
  return
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
  if (subcommand === "branch") return scan(values, BRANCH_WRITE, BRANCH_READ, BRANCH_CONSUME, BRANCH_PATTERN)
  if (subcommand === "tag") return scan(values, TAG_WRITE, TAG_READ, TAG_CONSUME, TAG_PATTERN)
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
    const rest = values.slice(1)
    if (rest.some((value) => value === "-m" || value.startsWith("--message"))) return true
    const name = rest.find((value) => !value.startsWith("-"))
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
    const name = verb(values, NOTES_FLAGS)
    if (!name) return false
    return !NOTES_READ.has(name)
  }
  if (READONLY.has(subcommand)) return false
  if (MUTATING.has(subcommand)) return true
  return true
}
