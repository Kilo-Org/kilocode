// kilocode_change - new file
import { Effect } from "effect"
import { InstanceState } from "../effect/instance-state"
import { Project } from "../project/project"
import { Filesystem } from "../util/filesystem"
import { Git } from "../git"

export namespace WorktreeFamily {
  export const list = Effect.fn("WorktreeFamily.list")(function* () {
    const ctx = yield* InstanceState.context
    if (ctx.project.vcs !== "git") {
      return [Filesystem.resolve(ctx.directory)]
    }

    const git = yield* Git.Service
    const listed = yield* git.run(["worktree", "list", "--porcelain"], {
      cwd: ctx.worktree,
    })

    if (listed.exitCode === 0) {
      const dirs = listed
        .text()
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          if (!line.startsWith("worktree ")) return []
          return [Filesystem.resolve(line.slice("worktree ".length).trim())]
        })

      if (dirs.length > 0) {
        return [...new Set(dirs)]
      }
    }

    const dirs = [ctx.worktree, ...(yield* Effect.promise(() => Project.sandboxes(ctx.project.id)))]
    return [...new Set(dirs.map((dir) => Filesystem.resolve(dir)))]
  })
}
