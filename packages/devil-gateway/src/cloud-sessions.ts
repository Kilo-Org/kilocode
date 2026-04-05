import { buildKiloHeaders } from "./headers.js"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DrizzleDb {
  insert(table: object): { values(data: object): { onConflictDoNothing(): { run(): void } } }
}

const INGEST_BASE = process.env.KILO_SESSION_INGEST_URL ?? "https://ingest.kilosessions.ai"

function exportUrl(sessionId: string) {
  return UUID_RE.test(sessionId)
    ? `${INGEST_BASE}/session/${sessionId}`
    : `${INGEST_BASE}/api/session/${sessionId}/export`
}

export type FetchResult = { ok: true; data: any } | { ok: false; status: number; error: string }

export async function fetchCloudSession(token: string, sessionId: string): Promise<FetchResult> {
  const response = await fetch(exportUrl(sessionId), {
    headers: {
      Authorization: `Bearer ${token}`,
      ...buildKiloHeaders(),
    },
  })

  if (response.status === 404) return { ok: false, status: 404, error: "Session not found" }
  if (!response.ok) return { ok: false, status: response.status, error: "Failed to fetch session" }

  const data = await response.json()
  return { ok: true, data }
}

export async function fetchCloudSessionForImport(token: string, sessionId: string): Promise<FetchResult> {
  const response = await fetch(exportUrl(sessionId), {
    headers: {
      Authorization: `Bearer ${token}`,
      ...buildKiloHeaders(),
    },
  })

  if (response.status === 404) return { ok: false, status: 404, error: "Session not found in cloud" }
  if (!response.ok) {
    const text = await response.text()
    console.error("[Kilo Gateway] cloud/session/import: export failed", {
      status: response.status,
      body: text.slice(0, 500),
    })
    return { ok: false, status: response.status, error: `Import failed: ${response.status}` }
  }

  const data = await response.json()
  return { ok: true, data }
}

export interface ImportDeps {
  Database: {
    transaction<T>(callback: (db: DrizzleDb) => T): T
    effect(fn: () => void | Promise<unknown>): void
  }
  Instance: {
    readonly directory: string
    readonly project: { readonly id: string }
  }
  SessionTable: object
  MessageTable: object
  PartTable: object
  SessionToRow: (info: any) => Record<string, unknown>
  Bus: { publish(event: { type: string; properties: unknown }, payload: unknown): void | Promise<unknown> }
  SessionCreatedEvent: { type: string; properties: unknown }
  Identifier: {
    ascending(prefix: "session" | "message" | "part", given?: string): string
    descending(prefix: "session" | "message" | "part", given?: string): string
  }
}

export function importSessionToDb(data: any, deps: ImportDeps) {
  const {
    Database,
    Instance,
    SessionTable,
    MessageTable,
    PartTable,
    SessionToRow,
    Bus,
    SessionCreatedEvent,
    Identifier,
  } = deps

  const localSessionID = Identifier.descending("session")
  const msgMap = new Map<string, string>()
  const projectID = Instance.project.id

  const now = Date.now()
  const time = {
    created: data.info.time?.created ?? now,
    updated: now,
    ...(data.info.time?.compacting !== undefined && { compacting: data.info.time.compacting }),
    ...(data.info.time?.archived !== undefined && { archived: data.info.time.archived }),
  }

  const info = {
    ...data.info,
    id: localSessionID,
    projectID,
    slug: data.info.slug,
    directory: Instance.directory,
    version: data.info.version,
    time,
  }

  Database.transaction((db) => {
    db.insert(SessionTable)
      .values(SessionToRow(info as Record<string, unknown>))
      .onConflictDoNothing()
      .run()

    const messages = Array.isArray(data.messages) ? data.messages : []
    for (const msg of messages.filter((m: any) => m.info)) {
      const msgID = Identifier.ascending("message")
      msgMap.set(msg.info.id, msgID)
      msg.info.id = msgID
      msg.info.sessionID = localSessionID
      if (msg.info.parentID) msg.info.parentID = msgMap.get(msg.info.parentID) ?? msg.info.parentID

      db.insert(MessageTable)
        .values({
          id: msgID,
          session_id: localSessionID,
          time_created: msg.info.time?.created ?? Date.now(),
          data: msg.info,
        })
        .onConflictDoNothing()
        .run()

      for (const part of msg.parts ?? []) {
        const partID = Identifier.ascending("part")
        part.id = partID
        part.messageID = msgID
        part.sessionID = localSessionID

        db.insert(PartTable)
          .values({
            id: partID,
            message_id: msgID,
            session_id: localSessionID,
            data: part,
          })
          .onConflictDoNothing()
          .run()
      }
    }

    Database.effect(() => Bus.publish(SessionCreatedEvent, { info }))
  })

  return info
}
