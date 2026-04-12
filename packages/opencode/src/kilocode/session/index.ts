// kilocode_change - new file
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Database, eq } from "@/storage/db"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { Filesystem } from "@/util/filesystem"

export namespace KiloSession {
  export const Event = {
    TurnOpen: BusEvent.define(
      "session.turn.open",
      z.object({
        sessionID: z.string(),
      }),
    ),
    TurnClose: BusEvent.define(
      "session.turn.close",
      z.object({
        sessionID: z.string(),
        reason: z.enum(["completed", "error", "interrupted"]),
      }),
    ),
  }

  export type CloseReason = z.infer<typeof Event.TurnClose.properties>["reason"]

  const overrides = new Map<string, string>()

  export function setPlatformOverride(id: string, platform: string) {
    overrides.set(id, platform)
  }

  export function getPlatformOverride(id: string): string | undefined {
    return overrides.get(id)
  }

  export function clearPlatformOverride(id: string) {
    overrides.delete(id)
  }

  export function family(id: string): string[] {
    const row = Database.use((db) =>
      db
        .select({ worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, ProjectID.make(id)))
        .get(),
    )
    const root = row?.worktree ? Filesystem.resolve(row.worktree) : undefined
    if (!root || root === "/") return [id]
    const ids = Database.use((db) =>
      db
        .select({ id: ProjectTable.id })
        .from(ProjectTable)
        .where(eq(ProjectTable.worktree, root))
        .all()
        .map((item) => item.id),
    )
    return ids.length ? ids : [id]
  }
}
