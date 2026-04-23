// kilocode_change - new file
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { Database, eq, asc } from "../storage"
import { TaskTable } from "./session.sql"
import { randomUUID } from "crypto"

export namespace Task {
  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      title: z.string(),
      description: z.string().default(""),
      status: z.enum(["open", "in_progress", "blocked", "done"]).default("open"),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
      assignee: z.string().optional(),
      dependsOn: z.array(z.string()).default([]),
      worktree: z.string().optional(),
      pr: z.string().optional(),
      summary: z.string().optional(),
      updatedAt: z.number(),
    })
    .meta({ ref: "Task" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "task.created",
      z.object({
        sessionID: SessionID.zod,
        task: Info,
      }),
    ),
    Updated: BusEvent.define(
      "task.updated",
      z.object({
        sessionID: SessionID.zod,
        task: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "task.deleted",
      z.object({
        sessionID: SessionID.zod,
        taskID: z.string(),
      }),
    ),
  }

  type Row = typeof TaskTable.$inferSelect

  function fromRow(row: Row): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      title: row.title,
      description: row.description,
      status: row.status as Info["status"],
      priority: row.priority as Info["priority"],
      assignee: row.assignee ?? undefined,
      dependsOn: row.depends_on ? (JSON.parse(row.depends_on) as string[]) : [],
      worktree: row.worktree ?? undefined,
      pr: row.pr ?? undefined,
      summary: row.summary ?? undefined,
      updatedAt: row.time_updated,
    }
  }

  function toRow(info: Info) {
    return {
      id: info.id,
      session_id: info.sessionID as SessionID,
      title: info.title,
      description: info.description,
      status: info.status,
      priority: info.priority,
      assignee: info.assignee ?? null,
      depends_on: JSON.stringify(info.dependsOn),
      worktree: info.worktree ?? null,
      pr: info.pr ?? null,
      summary: info.summary ?? null,
    }
  }

  export namespace Service {
    export async function create(input: {
      sessionID: string
      title: string
      description?: string
      priority?: Info["priority"]
      dependsOn?: string[]
      assignee?: string
    }): Promise<Info> {
      const id = randomUUID()
      const now = Date.now()
      const info: Info = {
        id,
        sessionID: input.sessionID,
        title: input.title,
        description: input.description ?? "",
        status: "open",
        priority: input.priority ?? "medium",
        assignee: input.assignee,
        dependsOn: input.dependsOn ?? [],
        worktree: undefined,
        pr: undefined,
        summary: undefined,
        updatedAt: now,
      }
      Database.transaction((db) => {
        db.insert(TaskTable)
          .values({
            ...toRow(info),
          })
          .run()
      })
      await Bus.publish(Event.Created, { sessionID: input.sessionID as SessionID, task: info })
      return info
    }

    export function list(sessionID: string): Info[] {
      const rows = Database.use((db) =>
        db
          .select()
          .from(TaskTable)
          .where(eq(TaskTable.session_id, sessionID as SessionID))
          .orderBy(asc(TaskTable.time_created))
          .all(),
      )
      return rows.map(fromRow)
    }

    export function get(taskID: string): Info | undefined {
      const row = Database.use((db) => db.select().from(TaskTable).where(eq(TaskTable.id, taskID)).get())
      return row ? fromRow(row) : undefined
    }

    export async function update(
      taskID: string,
      patch: Partial<
        Pick<
          Info,
          "title" | "description" | "status" | "priority" | "assignee" | "dependsOn" | "worktree" | "pr" | "summary"
        >
      >,
    ): Promise<Info> {
      const existing = get(taskID)
      if (!existing) throw new Error(`Task not found: ${taskID}`)
      const updated: Info = { ...existing, ...patch, updatedAt: Date.now() }
      Database.transaction((db) => {
        db.update(TaskTable)
          .set({
            title: updated.title,
            description: updated.description,
            status: updated.status,
            priority: updated.priority,
            assignee: updated.assignee ?? null,
            depends_on: JSON.stringify(updated.dependsOn),
            worktree: updated.worktree ?? null,
            pr: updated.pr ?? null,
            summary: updated.summary ?? null,
            time_updated: updated.updatedAt,
          })
          .where(eq(TaskTable.id, taskID))
          .run()
      })
      await Bus.publish(Event.Updated, { sessionID: updated.sessionID as SessionID, task: updated })
      return updated
    }

    export async function del(taskID: string): Promise<void> {
      const existing = get(taskID)
      if (!existing) return
      Database.transaction((db) => {
        db.delete(TaskTable).where(eq(TaskTable.id, taskID)).run()
      })
      await Bus.publish(Event.Deleted, { sessionID: existing.sessionID as SessionID, taskID })
    }

    export async function claim(taskID: string, assignee: string): Promise<Info> {
      return update(taskID, { status: "in_progress", assignee })
    }

    export async function complete(taskID: string, summary: string): Promise<Info> {
      return update(taskID, { status: "done", summary })
    }

    export async function block(taskID: string): Promise<Info> {
      return update(taskID, { status: "blocked" })
    }
  }
}
