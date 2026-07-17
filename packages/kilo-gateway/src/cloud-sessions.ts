import { buildKiloHeaders } from "./headers.js"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DrizzleDb {
  insert(table: object): { values(data: object): { onConflictDoNothing(): { run(): void } } }
}

type Export = {
  info: Record<string, unknown> & {
    time?: {
      created?: number
      updated?: number
      compacting?: number
      archived?: number
    }
  }
  messages?: unknown
}

export interface PrepareDeps {
  Instance: {
    readonly directory: string
    readonly project: { readonly id: string }
  }
  readonly workspaceID?: string
  readonly path?: string
  Identifier: {
    ascending(prefix: "session" | "message" | "part", given?: string): string
    descending(prefix: "session" | "message" | "part", given?: string): string
  }
}

export class SessionImportValidationError extends Error {}

const INGEST_BASE = process.env.KILO_SESSION_INGEST_URL ?? "https://ingest.kilosessions.ai"
const TIMEOUT = 30_000

function exportUrl(sessionId: string) {
  return UUID_RE.test(sessionId)
    ? `${INGEST_BASE}/session/${sessionId}`
    : `${INGEST_BASE}/api/session/${sessionId}/export`
}

export type FetchResult = { ok: true; data: any } | { ok: false; status: number; error: string }

export async function fetchCloudSession(token: string, sessionId: string): Promise<FetchResult> {
  const response = await fetch(exportUrl(sessionId), {
    signal: AbortSignal.timeout(TIMEOUT),
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
    signal: AbortSignal.timeout(TIMEOUT),
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

export interface ImportDeps extends PrepareDeps {
  Database: {
    transaction<T>(callback: (db: DrizzleDb) => T): T
    effect(fn: () => void | Promise<unknown>): void
  }
  SessionTable: object
  MessageTable: object
  PartTable: object
  SessionToRow: (info: any) => Record<string, unknown>
  Bus: { publish(event: { type: string; properties: unknown }, payload: unknown): void | Promise<unknown> }
  SessionCreatedEvent: { type: string; properties: unknown }
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

export function prepareSessionImport(data: Export, deps: PrepareDeps) {
  if (!record(data) || !record(data.info) || typeof data.info.id !== "string")
    throw new SessionImportValidationError("Invalid session info")
  if (!Array.isArray(data.messages)) throw new SessionImportValidationError("Invalid session messages")

  const sessionID = deps.Identifier.descending("session")
  const ids = new Map<string, string>()
  const pids = new Map<string, string>()
  const items: Array<{
    id: string
    created: number
    info: Record<string, unknown>
    parent?: string
    parts: Array<{
      id: string
      data: Record<string, unknown>
      tail?: string
      attachments?: Array<{ id: string; data: Record<string, unknown> }>
    }>
  }> = []

  for (const msg of data.messages) {
    if (!record(msg) || !record(msg.info) || !Array.isArray(msg.parts))
      throw new SessionImportValidationError("Invalid message")
    const id = msg.info.id
    const role = msg.info.role
    const time = msg.info.time
    if (
      typeof id !== "string" ||
      msg.info.sessionID !== data.info.id ||
      (role !== "user" && role !== "assistant") ||
      !record(time) ||
      typeof time.created !== "number" ||
      !Number.isFinite(time.created)
    )
      throw new SessionImportValidationError("Invalid message info")
    const parent = msg.info.parentID
    if (parent !== undefined && typeof parent !== "string")
      throw new SessionImportValidationError("Invalid message parent")
    if (ids.has(id)) throw new SessionImportValidationError("Duplicate message ID")
    ids.set(id, deps.Identifier.ascending("message"))

    const parts: Array<{
      id: string
      data: Record<string, unknown>
      tail?: string
      attachments?: Array<{ id: string; data: Record<string, unknown> }>
    }> = []
    for (const part of msg.parts) {
      if (
        !record(part) ||
        typeof part.id !== "string" ||
        part.sessionID !== data.info.id ||
        part.messageID !== id ||
        typeof part.type !== "string"
      )
        throw new SessionImportValidationError("Invalid message part")
      const tail = part.type === "compaction" ? part.tail_start_id : undefined
      if (tail !== undefined && typeof tail !== "string")
        throw new SessionImportValidationError("Invalid compaction tail")
      if (pids.has(part.id)) throw new SessionImportValidationError("Duplicate part ID")
      pids.set(part.id, deps.Identifier.ascending("part"))

      const state =
        part.type === "tool" && record(part.state) && part.state.status === "completed" ? part.state : undefined
      const attachments = (() => {
        if (!state || state.attachments === undefined) return
        if (!Array.isArray(state.attachments)) throw new SessionImportValidationError("Invalid tool attachments")
        const result: Array<{ id: string; data: Record<string, unknown> }> = []
        for (const attachment of state.attachments) {
          if (
            !record(attachment) ||
            typeof attachment.id !== "string" ||
            attachment.sessionID !== data.info.id ||
            attachment.messageID !== id ||
            attachment.type !== "file" ||
            typeof attachment.mime !== "string" ||
            typeof attachment.url !== "string"
          )
            throw new SessionImportValidationError("Invalid tool attachment")
          if (pids.has(attachment.id)) throw new SessionImportValidationError("Duplicate part ID")
          pids.set(attachment.id, deps.Identifier.ascending("part"))
          result.push({ id: attachment.id, data: attachment })
        }
        return result
      })()
      parts.push({
        id: part.id,
        data: part,
        ...(tail !== undefined ? { tail } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      })
    }
    items.push({ id, created: time.created, info: msg.info, parts, ...(parent !== undefined ? { parent } : {}) })
  }

  const parents = new Map(items.map((item) => [item.id, item.parent]))
  for (const item of items) {
    const seen = new Set([item.id])
    let parent = item.parent
    while (parent !== undefined) {
      if (seen.has(parent)) throw new SessionImportValidationError("Circular message parent")
      seen.add(parent)
      parent = parents.get(parent)
    }
  }

  const now = Date.now()
  const time = {
    created: data.info.time?.created ?? now,
    updated: now,
    ...(data.info.time?.compacting !== undefined && { compacting: data.info.time.compacting }),
    ...(data.info.time?.archived !== undefined && { archived: data.info.time.archived }),
  }

  const info: Record<string, unknown> & {
    id: string
    projectID: string
    directory: string
    time: typeof time
  } = {
    ...data.info,
    id: sessionID,
    projectID: deps.Instance.project.id,
    slug: data.info.slug,
    directory: deps.Instance.directory,
    version: data.info.version,
    time,
  }
  delete info.workspaceID
  delete info.path
  if (deps.workspaceID !== undefined) info.workspaceID = deps.workspaceID
  if (deps.path !== undefined) info.path = deps.path
  delete info.parentID
  delete info.share
  delete info.revert
  delete info.permission

  const messages: Array<{
    id: string
    session_id: string
    time_created: number
    data: Record<string, unknown>
  }> = []
  const parts: Array<{
    id: string
    message_id: string
    session_id: string
    data: Record<string, unknown>
  }> = []
  for (const item of items) {
    const id = ids.get(item.id)
    if (!id) throw new SessionImportValidationError("Missing message ID")
    const parentID = item.parent === undefined ? undefined : ids.get(item.parent)
    if (item.parent !== undefined && !parentID) throw new SessionImportValidationError("Dangling message parent")
    const next = {
      ...item.info,
      id,
      sessionID,
      ...(parentID ? { parentID } : {}),
    }
    messages.push({ id, session_id: sessionID, time_created: item.created, data: next })

    for (const part of item.parts) {
      const partID = pids.get(part.id)
      if (!partID) throw new SessionImportValidationError("Missing part ID")
      const tail = part.tail === undefined ? undefined : ids.get(part.tail)
      if (part.tail !== undefined && !tail) throw new SessionImportValidationError("Dangling compaction tail")
      const data: Record<string, unknown> = {
        ...part.data,
        id: partID,
        messageID: id,
        sessionID,
        ...(tail ? { tail_start_id: tail } : {}),
      }
      if (part.attachments) {
        const state = part.data.state
        if (!record(state)) throw new SessionImportValidationError("Invalid tool state")
        data.state = {
          ...state,
          attachments: part.attachments.map((attachment) => {
            const attachmentID = pids.get(attachment.id)
            if (!attachmentID) throw new SessionImportValidationError("Missing attachment ID")
            return { ...attachment.data, id: attachmentID, messageID: id, sessionID }
          }),
        }
      }
      parts.push({
        id: partID,
        message_id: id,
        session_id: sessionID,
        data,
      })
    }
  }

  return { info, messages, parts }
}

export function importSessionToDb(data: Export, deps: ImportDeps) {
  const prepared = prepareSessionImport(data, deps)

  deps.Database.transaction((db) => {
    db.insert(deps.SessionTable).values(deps.SessionToRow(prepared.info)).onConflictDoNothing().run()

    for (const row of prepared.messages) {
      const { id: _, sessionID: __, ...data } = row.data
      db.insert(deps.MessageTable)
        .values({ id: row.id, session_id: row.session_id, time_created: row.time_created, data })
        .onConflictDoNothing()
        .run()
    }
    for (const row of prepared.parts) {
      const { id: _, messageID: __, sessionID: ___, ...data } = row.data
      db.insert(deps.PartTable)
        .values({ id: row.id, message_id: row.message_id, session_id: row.session_id, data })
        .onConflictDoNothing()
        .run()
    }

    deps.Database.effect(() => deps.Bus.publish(deps.SessionCreatedEvent, { info: prepared.info }))
  })

  return prepared.info
}
