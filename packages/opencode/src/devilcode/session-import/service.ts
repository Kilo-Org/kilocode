import { Database } from "../../storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { SessionImportType } from "./types"
import { Project } from "../../project/project"
import { eq } from "drizzle-orm"

const key = (input: unknown) => [input] as never
const target = (input: unknown) => input as never

export namespace SessionImportService {
  export async function project(input: SessionImportType.Project): Promise<SessionImportType.Result> {

    // Do not resolve an empty legacy worktree, because that would fall back to the current
    // process directory and silently attach the migrated session to the wrong project.
    if (!input.worktree.trim()) {
      throw new Error("Legacy project import requires a non-empty worktree")
    }

    const result = await Project.fromDirectory(input.worktree)
    return { ok: true, id: result.project.id }
  }

  export async function session(input: SessionImportType.Session): Promise<SessionImportType.Result> {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(target(SessionTable.id), input.id)).get())
    if (row) return { ok: true, id: input.id, skipped: true }

    Database.use((db) => {
      db.insert(SessionTable)
        .values({
          id: input.id,
          project_id: input.projectID,
          workspace_id: input.workspaceID,
          parent_id: input.parentID,
          slug: input.slug,
          directory: input.directory,
          title: input.title,
          version: input.version,
          share_url: input.shareURL,
          summary_additions: input.summary?.additions,
          summary_deletions: input.summary?.deletions,
          summary_files: input.summary?.files,
          summary_diffs: input.summary?.diffs as never,
          revert: input.revert,
          permission: input.permission as never,
          time_created: input.timeCreated,
          time_updated: input.timeUpdated,
          time_compacting: input.timeCompacting,
          time_archived: input.timeArchived,
        })
        .onConflictDoNothing({
          target: key(SessionTable.id),
        })
        .run()
    })
    return { ok: true, id: input.id }
  }

  export async function message(input: SessionImportType.Message): Promise<SessionImportType.Result> {
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id: input.id,
          session_id: input.sessionID,
          time_created: input.timeCreated,
          data: input.data as never,
        })
        .onConflictDoUpdate({
          target: key(MessageTable.id),
          set: {
            data: input.data as never,
          },
        })
        .run()
    })
    return { ok: true, id: input.id }
  }

  export async function part(input: SessionImportType.Part): Promise<SessionImportType.Result> {
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id: input.id,
          message_id: input.messageID,
          session_id: input.sessionID,
          time_created: input.timeCreated,
          data: input.data as never,
        })
        .onConflictDoUpdate({
          target: key(PartTable.id),
          set: {
            data: input.data as never,
          },
        })
        .run()
    })
    return { ok: true, id: input.id }
  }
}
