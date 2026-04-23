// kilocode_change - new file
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "./schema"
import z from "zod"

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
}
