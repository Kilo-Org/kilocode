import { existsSync } from "fs"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { Git } from "../git"

export const primaryPaths = Effect.fn("PrimaryWorktree.paths")(function* (
  dir: string,
  root: string,
  names: readonly string[],
) {
  const cwd = FSUtil.normalizePath(path.resolve(root))
  const primary = yield* primaryWorktree(cwd)
  if (!primary || primary === cwd) return []

  // Mirror the active directory's path relative to the linked-worktree root into the primary checkout.
  // If the directory is outside that root, fall back to searching from the primary checkout root only.
  const active = FSUtil.normalizePath(path.resolve(dir))
  const rel = path.relative(cwd, active)
  const parts = rel ? rel.split(path.sep) : []
  if (path.isAbsolute(rel) || parts[0] === "..") parts.length = 0

  // Search the mirrored directory and each ancestor up to the primary root, preserving nearest-first order.
  const dirs = []
  for (const index of parts.keys()) {
    dirs.push(path.join(primary, ...parts.slice(0, parts.length - index)))
  }
  dirs.push(primary)

  const found = []
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)
      if (existsSync(file)) found.push(file)
    }
  }
  return found
})

export const primaryWorktree = Effect.fn("PrimaryWorktree.find")(function* (dir: string) {
  const cwd = FSUtil.normalizePath(path.resolve(dir))
  const git = yield* Git.Service
  const run = Effect.fnUntraced(function* (args: string[], at = cwd) {
    const result = yield* git.run(args, { cwd: at })
    return result.exitCode === 0 ? result.text() : undefined
  })
  const resolve = (value: string, from = cwd) =>
    FSUtil.normalizePath(path.isAbsolute(value) ? path.normalize(value) : path.resolve(from, value))
  // A POSIX path can contain a carriage return, so "\r\n" only counts as a line break on Windows.
  const eol = process.platform === "win32" ? /\r?\n/ : /\n/
  const line = (value: string | undefined) => value?.replace(new RegExp(`${eol.source}$`), "")
  // One rev-parse answers all four questions, in argument order. Outside a
  // work tree --show-toplevel fails, so the command fails as a whole.
  // --path-format=absolute is left out because git before 2.31 prints it back as an output line with exit code 0.
  const info = yield* run(["rev-parse", "--is-inside-work-tree", "--show-toplevel", "--git-dir", "--git-common-dir"])
  if (info === undefined) return undefined
  const lines = line(info)!.split(eol)
  // A path that contains a newline spreads over extra lines; fall back to one query per field.
  const [inside, root, gitdir, common] =
    lines.length === 4
      ? lines
      : [
          line(yield* run(["rev-parse", "--is-inside-work-tree"])),
          line(yield* run(["rev-parse", "--show-toplevel"])),
          line(yield* run(["rev-parse", "--git-dir"])),
          line(yield* run(["rev-parse", "--git-common-dir"])),
        ]
  if (inside !== "true" || !root || !gitdir || !common) return undefined
  if (resolve(gitdir) === resolve(common)) return resolve(root)

  // -z needs git 2.36. The newline form cuts a path that contains a newline short, and the cut path can
  // be an unrelated directory. A primary checkout read from it must have the common directory as its git directory.
  const nul = yield* run(["worktree", "list", "--porcelain", "-z"])
  const listing = nul ?? (yield* run(["worktree", "list", "--porcelain"]))?.replace(new RegExp(eol.source, "g"), "\0")
  const fields = listing?.split("\0\0", 1)[0]?.split("\0")
  const worktree = fields?.find((field) => field.startsWith("worktree "))
  if (!worktree || fields?.includes("bare")) return undefined
  const primary = resolve(worktree.slice("worktree ".length))
  if (nul !== undefined) return primary
  if (!existsSync(primary)) return undefined
  const own = line(yield* run(["rev-parse", "--git-dir"], primary))
  // Compare real paths, since --git-common-dir can be relative to a cwd reached through a symlink.
  return own && FSUtil.resolve(resolve(own, primary)) === FSUtil.resolve(resolve(common)) ? primary : undefined
})
