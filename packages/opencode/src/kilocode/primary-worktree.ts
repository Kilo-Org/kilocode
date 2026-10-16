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
  const run = Effect.fnUntraced(function* (args: string[]) {
    const result = yield* git.run(args, { cwd })
    return result.exitCode === 0 ? result.text() : undefined
  })
  const resolve = (value: string) =>
    FSUtil.normalizePath(path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value))
  const line = (value: string | undefined) => value?.replace(/\r?\n$/, "")
  // One rev-parse answers all four questions, in argument order. Outside a
  // work tree --show-toplevel fails, so the command fails as a whole.
  const info = yield* run([
    "rev-parse",
    "--is-inside-work-tree",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  ])
  if (info === undefined) return undefined
  const lines = line(info)!.split(/\r?\n/)
  // A path that contains a newline spreads over extra lines; fall back to one query per field.
  const [inside, root, gitdir, common] =
    lines.length === 4
      ? lines
      : [
          line(yield* run(["rev-parse", "--is-inside-work-tree"])),
          line(yield* run(["rev-parse", "--path-format=absolute", "--show-toplevel"])),
          line(yield* run(["rev-parse", "--path-format=absolute", "--git-dir"])),
          line(yield* run(["rev-parse", "--path-format=absolute", "--git-common-dir"])),
        ]
  if (inside !== "true" || !root || !gitdir || !common) return undefined
  if (resolve(gitdir) === resolve(common)) return resolve(root)

  const listing = yield* run(["worktree", "list", "--porcelain", "-z"])
  const fields = listing?.split("\0\0", 1)[0]?.split("\0")
  const worktree = fields?.find((field) => field.startsWith("worktree "))
  if (!worktree || fields?.includes("bare")) return undefined
  return resolve(worktree.slice("worktree ".length))
})
