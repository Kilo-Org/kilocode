import { Database } from "../../storage"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { SessionID, MessageID, PartID } from "../../session/schema"
import { ProjectID } from "../../project/schema"
import { WorkspaceID } from "../../control-plane/schema"
import { SessionImportType } from "./types"
import { Project } from "../../project"
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
    const row = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(eq(target(SessionTable.id), input.id))
        .get(),
    )
    if (row && !input.force) return { ok: true, id: input.id, skipped: true }

    Database.use((db) => {
      if (row && input.force) {
        db.delete(SessionTable)
          .where(eq(target(SessionTable.id), input.id))
          .run()
      }
      // We still keep onConflictDoUpdate here so forced reimports can recreate the session row
      // and non-forced calls remain idempotent if they reach the DB after the existence guard.
      db.insert(SessionTable)
        .values({
          id: SessionID.make(input.id),
          project_id: ProjectID.make(input.projectID),
          workspace_id: input.workspaceID ? WorkspaceID.make(input.workspaceID) : undefined,
          parent_id: input.parentID ? SessionID.make(input.parentID) : undefined,
          slug: input.slug,
          directory: input.directory,
          title: input.title,
          version: input.version,
          share_url: input.shareURL,
          summary_additions: input.summary?.additions,
          summary_deletions: input.summary?.deletions,
          summary_files: input.summary?.files,
          summary_diffs: input.summary?.diffs as never,
          revert: input.revert
            ? {
                ...input.revert,
                messageID: MessageID.make(input.revert.messageID),
                partID: input.revert.partID ? PartID.make(input.revert.partID) : undefined,
              }
            : undefined,
          permission: input.permission as never,
          time_created: input.timeCreated,
          time_updated: input.timeUpdated,
          time_compacting: input.timeCompacting,
          time_archived: input.timeArchived,
        })
        .onConflictDoUpdate({
          target: key(SessionTable.id),
          set: {
            project_id: ProjectID.make(input.projectID),
            workspace_id: input.workspaceID ? WorkspaceID.make(input.workspaceID) : undefined,
            parent_id: input.parentID ? SessionID.make(input.parentID) : undefined,
            slug: input.slug,
            directory: input.directory,
            title: input.title,
            version: input.version,
            share_url: input.shareURL,
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            summary_diffs: input.summary?.diffs as never,
            revert: input.revert
              ? {
                  ...input.revert,
                  messageID: MessageID.make(input.revert.messageID),
                  partID: input.revert.partID ? PartID.make(input.revert.partID) : undefined,
                }
              : undefined,
            permission: input.permission as never,
            time_created: input.timeCreated,
            time_updated: input.timeUpdated,
            time_compacting: input.timeCompacting,
            time_archived: input.timeArchived,
          },
        })
        .run()
    })
    return { ok: true, id: input.id }
  }

  export async function message(input: SessionImportType.Message): Promise<SessionImportType.Result> {
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id: MessageID.make(input.id),
          session_id: SessionID.make(input.sessionID),
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
          id: PartID.make(input.id),
          message_id: MessageID.make(input.messageID),
          session_id: SessionID.make(input.sessionID),
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
