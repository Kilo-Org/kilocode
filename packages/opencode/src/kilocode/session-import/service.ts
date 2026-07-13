import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { SessionID, MessageID, PartID } from "../../session/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { SessionImportType } from "./types"
import { Project } from "../../project/project"
import { AppRuntime } from "../../effect/app-runtime"
import { eq } from "drizzle-orm"
import { Effect } from "effect"

const key = (input: unknown) => [input] as never
const target = (input: unknown) => input as never

export namespace SessionImportService {
  export async function project(input: SessionImportType.Project): Promise<SessionImportType.Result> {
    // Do not resolve an empty legacy worktree, because that would fall back to the current
    // process directory and silently attach the migrated session to the wrong project.
    if (!input.worktree.trim()) {
      throw new Error("Legacy project import requires a non-empty worktree")
    }

    const result = await AppRuntime.runPromise(Project.Service.use((svc) => svc.fromDirectory(input.worktree)))
    return { ok: true, id: result.project.id }
  }

  export async function session(input: SessionImportType.Session): Promise<SessionImportType.Result> {
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(target(SessionTable.id), input.id))
          .get()
        if (row && !input.force) return { ok: true, id: input.id, skipped: true }

        if (row && input.force)
          yield* db
            .delete(SessionTable)
            .where(eq(target(SessionTable.id), input.id))
            .run()

        const revert = input.revert
          ? {
              ...input.revert,
              messageID: MessageID.make(input.revert.messageID),
              partID: input.revert.partID ? PartID.make(input.revert.partID) : undefined,
            }
          : undefined
        yield* db
          .insert(SessionTable)
          .values({
            id: SessionID.make(input.id),
            project_id: ProjectV2.ID.make(input.projectID),
            workspace_id: input.workspaceID ? WorkspaceV2.ID.make(input.workspaceID) : undefined,
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
            revert,
            permission: input.permission as never,
            time_created: input.timeCreated,
            time_updated: input.timeUpdated,
            time_compacting: input.timeCompacting,
            time_archived: input.timeArchived,
          })
          .onConflictDoUpdate({
            target: key(SessionTable.id),
            set: {
              project_id: ProjectV2.ID.make(input.projectID),
              workspace_id: input.workspaceID ? WorkspaceV2.ID.make(input.workspaceID) : undefined,
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
              revert,
              permission: input.permission as never,
              time_created: input.timeCreated,
              time_updated: input.timeUpdated,
              time_compacting: input.timeCompacting,
              time_archived: input.timeArchived,
            },
          })
          .run()
        return { ok: true, id: input.id }
      }),
    )
  }

  export async function message(input: SessionImportType.Message): Promise<SessionImportType.Result> {
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db
          .insert(MessageTable)
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
        return { ok: true, id: input.id }
      }),
    )
  }

  export async function part(input: SessionImportType.Part): Promise<SessionImportType.Result> {
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db
          .insert(PartTable)
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
        return { ok: true, id: input.id }
      }),
    )
  }
}
