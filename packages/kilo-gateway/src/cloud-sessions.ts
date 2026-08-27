import { z } from "zod"
import { buildKiloHeaders } from "./headers.js"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DrizzleDb {
  insert(table: object): { values(data: object): { onConflictDoNothing(): { run(): void } } }
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

const fileSchema = z
  .object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    type: z.literal("file"),
    mime: z.string(),
    url: z.string(),
  })
  .passthrough()

const stateSchema = z
  .object({
    status: z.literal("completed"),
    attachments: z.array(fileSchema).optional(),
  })
  .passthrough()

const partSchema = z
  .object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    type: z.string(),
    tail_start_id: z.unknown().optional(),
    state: z.unknown().optional(),
  })
  .passthrough()

const messageSchema = z.object({
  info: z
    .object({
      id: z.string(),
      sessionID: z.string(),
      parentID: z.string().optional(),
      role: z.enum(["user", "assistant"]),
      time: z.object({ created: z.number().finite() }).passthrough(),
    })
    .passthrough(),
  parts: z.array(partSchema),
})

const exportSchema = z
  .object({
    info: z
      .object({
        id: z.string(),
        time: z
          .object({
            created: z.number().optional(),
            updated: z.number().optional(),
            compacting: z.number().optional(),
            archived: z.number().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    messages: z.array(messageSchema),
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>()
    const pids = new Set<string>()
    const parents = new Map<string, string | undefined>()

    for (const msg of data.messages) {
      if (msg.info.sessionID !== data.info.id) ctx.addIssue({ code: "custom", message: "Invalid message info" })
      if (ids.has(msg.info.id)) ctx.addIssue({ code: "custom", message: "Duplicate message ID" })
      ids.add(msg.info.id)
      parents.set(msg.info.id, msg.info.parentID)

      for (const part of msg.parts) {
        if (part.sessionID !== data.info.id || part.messageID !== msg.info.id)
          ctx.addIssue({ code: "custom", message: "Invalid message part" })
        if (part.type === "compaction" && part.tail_start_id !== undefined && typeof part.tail_start_id !== "string")
          ctx.addIssue({ code: "custom", message: "Invalid compaction tail" })
        if (pids.has(part.id)) ctx.addIssue({ code: "custom", message: "Duplicate part ID" })
        pids.add(part.id)

        if (part.type !== "tool") continue
        const status = z.object({ status: z.unknown() }).safeParse(part.state)
        if (!status.success || status.data.status !== "completed") continue
        const state = stateSchema.safeParse(part.state)
        if (!state.success) {
          ctx.addIssue({ code: "custom", message: "Invalid tool attachments" })
          continue
        }
        for (const file of state.data.attachments ?? []) {
          if (file.sessionID !== data.info.id || file.messageID !== msg.info.id)
            ctx.addIssue({ code: "custom", message: "Invalid tool attachment" })
          if (pids.has(file.id)) ctx.addIssue({ code: "custom", message: "Duplicate part ID" })
          pids.add(file.id)
        }
      }
    }

    for (const msg of data.messages) {
      const parent = msg.info.parentID
      if (parent !== undefined && !ids.has(parent))
        ctx.addIssue({ code: "custom", message: "Dangling message parent" })

      const seen = new Set([msg.info.id])
      let current = parent
      while (current !== undefined) {
        if (seen.has(current)) {
          ctx.addIssue({ code: "custom", message: "Circular message parent" })
          break
        }
        seen.add(current)
        current = parents.get(current)
      }

      for (const part of msg.parts) {
        if (part.type !== "compaction" || typeof part.tail_start_id !== "string") continue
        if (!ids.has(part.tail_start_id)) ctx.addIssue({ code: "custom", message: "Dangling compaction tail" })
      }
    }
  })

function completed(part: z.infer<typeof partSchema>) {
  if (part.type !== "tool") return
  const result = stateSchema.safeParse(part.state)
  if (!result.success) return
  return result.data
}

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

export function prepareSessionImport(data: unknown, deps: PrepareDeps) {
  const parsed = exportSchema.safeParse(data)
  if (!parsed.success)
    throw new SessionImportValidationError(parsed.error.issues[0]?.message ?? "Invalid session export")
  const source = parsed.data

  const sessionID = deps.Identifier.descending("session")
  const ids = new Map<string, string>()
  const pids = new Map<string, string>()
  for (const msg of source.messages) {
    ids.set(msg.info.id, deps.Identifier.ascending("message"))
    for (const part of msg.parts) {
      pids.set(part.id, deps.Identifier.ascending("part"))
      for (const file of completed(part)?.attachments ?? []) {
        pids.set(file.id, deps.Identifier.ascending("part"))
      }
    }
  }

  const now = Date.now()
  const time = {
    created: source.info.time?.created ?? now,
    updated: now,
    ...(source.info.time?.compacting !== undefined && { compacting: source.info.time.compacting }),
    ...(source.info.time?.archived !== undefined && { archived: source.info.time.archived }),
  }

  const info: Record<string, unknown> & {
    id: string
    projectID: string
    directory: string
    time: typeof time
  } = {
    ...source.info,
    id: sessionID,
    projectID: deps.Instance.project.id,
    slug: source.info.slug,
    directory: deps.Instance.directory,
    version: source.info.version,
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
  for (const msg of source.messages) {
    const id = ids.get(msg.info.id)!
    const parentID = msg.info.parentID === undefined ? undefined : ids.get(msg.info.parentID)!
    const next = {
      ...msg.info,
      id,
      sessionID,
      ...(parentID ? { parentID } : {}),
    }
    messages.push({ id, session_id: sessionID, time_created: msg.info.time.created, data: next })

    for (const part of msg.parts) {
      const partID = pids.get(part.id)!
      const tail =
        part.type === "compaction" && typeof part.tail_start_id === "string"
          ? ids.get(part.tail_start_id)!
          : undefined
      const data: Record<string, unknown> = {
        ...part,
        id: partID,
        messageID: id,
        sessionID,
        ...(tail ? { tail_start_id: tail } : {}),
      }
      const state = completed(part)
      if (state?.attachments) {
        data.state = {
          ...state,
          attachments: state.attachments.map((file) => {
            const fileID = pids.get(file.id)!
            return { ...file, id: fileID, messageID: id, sessionID }
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

export function importSessionToDb(data: unknown, deps: ImportDeps) {
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
