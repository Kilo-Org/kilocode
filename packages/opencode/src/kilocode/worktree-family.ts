import type { InstanceContext } from "../project/instance"
import type { Project } from "../project/project"
import { Filesystem } from "../util/filesystem"
import { Git } from "../git"
import { Effect } from "effect"

export namespace WorktreeFamily {
  export const list = Effect.fn("WorktreeFamily.list")(function* (project: Project.Interface, ctx: InstanceContext) {
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

    const dirs = [ctx.worktree, ...(yield* project.sandboxes(ctx.project.id))]
    return [...new Set(dirs.map((dir) => Filesystem.resolve(dir)))]
  })
}
