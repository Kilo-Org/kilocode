import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"

// The primary checkout of the Git repository that contains `dir`. For a linked worktree it is the first entry of
// `git worktree list`; for the primary checkout itself it is its top level. Outside Git, or for a bare repository,
// it is undefined.
export const primaryWorktree = Effect.fn("PrimaryWorktree.find")(function* (dir: string) {
  const cwd = FSUtil.normalizePath(path.resolve(dir))
  const run = (args: string[]) =>
    Effect.promise(async () => {
      const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", windowsHide: true })
      const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return code === 0 ? text : undefined
    }).pipe(Effect.orElseSucceed(() => undefined))
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
