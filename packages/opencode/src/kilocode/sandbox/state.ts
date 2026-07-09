import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"

export const key = "kilocode.sandbox"

export type Value = {
  enabled: boolean
  version: number
}

export function parse(metadata: Record<string, unknown> | null | undefined): Value | undefined {
  const value = metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const enabled = Reflect.get(value, "enabled")
  const version = Reflect.get(value, "version")
  if (typeof enabled !== "boolean" || !Number.isInteger(version) || (version as number) < 0) return
  return { enabled, version: version as number }
}

export function merge(metadata: Record<string, unknown> | null | undefined, value: Value) {
  return { ...metadata, [key]: value }
}

export function inherit(metadata: Record<string, unknown> | null | undefined) {
  const value = parse(metadata)
  if (!value) return
  return merge(undefined, { enabled: value.enabled, version: 0 })
}

export function remove(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !(key in metadata)) return metadata
  const next = { ...metadata }
  delete next[key]
  return next
}

export const read = Effect.fn("SandboxState.read")((sessionID: SessionID) =>
  Effect.sync(() =>
    Database.use((db) =>
      parse(
        db.select({ metadata: SessionTable.metadata }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
          ?.metadata,
      ),
    ),
  ),
)

export const write = Effect.fn("SandboxState.write")((sessionID: SessionID, value: Value) =>
  Effect.sync(() =>
    Database.use((db) => {
      const row = db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) return
      db.update(SessionTable)
        .set({ metadata: merge(row.metadata, value), time_updated: Date.now() })
        .where(eq(SessionTable.id, sessionID))
        .run()
    }),
  ),
)

export const clear = Effect.fn("SandboxState.clear")((sessionID: SessionID) =>
  Effect.sync(() =>
    Database.use((db) => {
      const row = db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) return
      db.update(SessionTable)
        .set({ metadata: remove(row.metadata), time_updated: Date.now() })
        .where(eq(SessionTable.id, sessionID))
        .run()
    }),
  ),
)
