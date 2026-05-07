// kilocode_change - new file
import { Instance } from "../project/instance"
import { ProjectTable } from "../project/project.sql"
import { Database, eq } from "../storage/db"
import { Filesystem } from "../util/filesystem"
import { Git } from "../git"

export namespace WorktreeFamily {
  function saved() {
    const row = Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree, sandboxes: ProjectTable.sandboxes })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, Instance.project.id))
        .get(),
    )
    if (!row) return []
    return [row.worktree, ...row.sandboxes]
  }

  export async function list() {
    if (Instance.project.vcs !== "git") {
      return [Filesystem.resolve(Instance.directory)]
    }

    const listed = await Git.run(["worktree", "list", "--porcelain"], {
      cwd: Instance.worktree,
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

      if (dirs.length > 0) return [...new Set([...dirs, ...saved()].map((dir) => Filesystem.resolve(dir)))]
    }

    const dirs = [Instance.worktree, ...saved()]
    return [...new Set(dirs.map((dir) => Filesystem.resolve(dir)))]
  }
}
