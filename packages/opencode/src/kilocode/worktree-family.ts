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
        // In a git submodule, `git worktree list --porcelain` reports the
        // gitdir (`<repo>/.git/modules/<sub>`) instead of the actual working
        // tree, so the parsed list never contains the directory sessions are
        // recorded under. Including the context worktree keeps submodule sessions
        // in scope without affecting normal repos (already present) or linked
        // worktrees (also already present).
        dirs.push(Filesystem.resolve(ctx.worktree))
        return [...new Set(dirs)]
      }
    }

    const project = yield* Project.Service
    const dirs = [ctx.worktree, ...(yield* project.sandboxes(ctx.project.id))]
    return [...new Set(dirs.map((dir) => Filesystem.resolve(dir)))]
  })
}
