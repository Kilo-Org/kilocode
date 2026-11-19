import { Schema } from "effect"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { invalidResponse } from "./live-io.js"
import { conversationContent, conversationEvent, conversationRow, startedStep } from "./live-conversation.js"
import {
  info,
  part,
  legacyContent,
  legacyMessage,
  legacyPage,
  withParts,
  type Content,
  type Row,
} from "./live-legacy.js"

export const PAGE_SIZE = 40
const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,255}$/))
const frame = Schema.decodeUnknownSync(
  Schema.Struct({
    type: Schema.String,
    properties: Schema.Record(Schema.String, Schema.Unknown),
  }),
)
const question = Schema.decodeUnknownSync(
  Schema.Struct({
    id: ID,
    questions: Schema.Array(
      Schema.Struct({
        header: Schema.optional(Schema.String),
        question: Schema.String,
        multiple: Schema.optional(Schema.Boolean),
        custom: Schema.optional(Schema.Boolean),
        options: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.optional(Schema.String) })),
      }),
    ),
  }),
)
const permission = Schema.decodeUnknownSync(
  Schema.Struct({ id: ID, permission: Schema.String, patterns: Schema.Array(Schema.String) }),
)
const delta = Schema.decodeUnknownSync(
  Schema.Struct({ messageID: ID, partID: ID, field: Schema.String, delta: Schema.String }),
)
const status = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literals(["busy", "idle", "retry"]) }))

function order(a: Row, b: Row) {
  return a.message.time.created - b.message.time.created || a.message.id.localeCompare(b.message.id, "en")
}

export function parsePage(raw: unknown, sessionID: string): Row[] {
  return legacyPage(raw, sessionID).sort(order)
}

export function messages(rows: Row[]): KiloHostedRpc.Message[] {
  return rows.map((row) => row.message)
}

/** The fenced projection is built off-screen. Only a completed fence may replace the open view. */
export class Projection {
  private rows: Row[]
  private readonly boundary?: Row
  private readonly questions = new Map<string, KiloHostedRpc.Question>()
  private readonly queued = new Set<string>()
  private readonly permissions = new Map<string, KiloHostedRpc.Permission>()
  private status: KiloHostedRpc.Snapshot["status"] = "unknown"
  private textSize: number
  fenced = false

  constructor(
    private readonly sessionID: string,
    initial: Row[],
    private readonly before?: string,
  ) {
    this.rows = [...initial].sort(order)
    this.boundary = before ? this.rows[0] : undefined
    this.textSize = this.rows.reduce((sum, row) => sum + this.size(row), 0)
  }

  snapshot(connection: KiloHostedRpc.Snapshot["connection"]): KiloHostedRpc.Snapshot {
    return {
      connection,
      status: connection === "live" ? this.status : "unknown",
      messages: messages(this.rows),
      ...(connection === "live" && this.queued.size && { queued: [...this.queued] }),
      ...(this.before && { before: this.before }),
      questions: connection === "live" ? [...this.questions.values()] : [],
      permissions: connection === "live" ? [...this.permissions.values()] : [],
    }
  }

  replay() {
    return new Projection(this.sessionID, this.rows, this.before)
  }

  get empty() {
    return this.rows.length === 0
  }

  apply(raw: unknown) {
    const { type, properties } = frame(raw)
    if (properties.sessionID !== this.sessionID) return false
    if (properties.directory !== undefined && properties.directory !== `/cloud-agent/sessions/${this.sessionID}`)
      return false
    switch (type) {
      case "kilo.native.resnapshot":
        throw invalidResponse()
      case "kilo.native.fence":
        if (properties.snapshotComplete !== true) throw invalidResponse()
        this.fenced = true
        return true
      case "message.updated": {
        return this.legacyUpdate(properties.info)
      }
      case "conversation.message.updated": {
        const row = conversationRow(this.sessionID, properties)
        return row ? this.upsert(row) : false
      }
      case "conversation.event":
        return this.nativeEvent(properties)
      case "message.part.updated": {
        const value = part(properties.part)
        const row = this.find(value.messageID)
        if (value.sessionID !== this.sessionID || !row) return false
        return this.updatePart(row, value.id, legacyContent(value, row.message.time.created))
      }
      case "message.part.delta":
        return this.append(delta(properties))
      case "message.removed":
        return this.remove(properties.messageID)
      case "message.part.removed":
        return this.updatePart(this.find(properties.messageID), String(properties.partID), undefined)
      case "session.status":
        this.status = status(properties.status).type
        return true
      case "session.idle":
        this.status = "idle"
        return true
      default:
        return this.interaction(type, properties)
    }
  }

  private interaction(type: string, properties: Record<string, unknown>) {
    if (type.startsWith("cloud.message.")) return this.delivery(type, properties.messageId)
    switch (type) {
      case "question.asked": {
        const item = question(properties)
        if (this.questions.size >= 32 && !this.questions.has(item.id)) throw invalidResponse()
        this.questions.set(item.id, {
          id: item.id,
          questions: item.questions.map((q) => ({
            header: q.header ?? "",
            question: q.question,
            multiple: q.multiple ?? false,
            custom: q.custom ?? true,
            options: q.options.map((o) => ({ label: o.label, description: o.description ?? "" })),
          })),
        })
        return true
      }
      case "permission.asked": {
        const item = permission(properties)
        if (this.permissions.size >= 32 && !this.permissions.has(item.id)) throw invalidResponse()
        this.permissions.set(item.id, item)
        return true
      }
      case "permission.replied":
        return this.permissions.delete(String(properties.requestID))
      case "question.replied":
      case "question.rejected":
        return this.questions.delete(String(properties.requestID))
      default:
        return false
    }
  }

  private delivery(type: string, id: unknown) {
    if (typeof id !== "string" || !/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(id)) return false
    if (type === "cloud.message.queued") {
      if (this.queued.size >= 256 || this.queued.has(id)) return false
      this.queued.add(id)
      return true
    }
    return (
      ["cloud.message.sent", "cloud.message.completed", "cloud.message.failed", "cloud.message.canceled"].includes(
        type,
      ) && this.queued.delete(id)
    )
  }

  private nativeEvent(properties: Record<string, unknown>) {
    const event = conversationEvent(properties.event)
    if (event.data.sessionID !== this.sessionID) return false
    const row = this.find(event.data.assistantMessageID)
    if (!row) {
      const started = startedStep(event)
      return started ? this.upsert(started) : false
    }
    if (row?.message.type !== "assistant") return false
    const message = conversationContent(row.message, event)
    return message ? this.upsert({ message }) : false
  }

  private legacyUpdate(raw: unknown) {
    const value = info(raw)
    if (value.sessionID !== this.sessionID) return false
    const current = this.find(value.id)
    const row = legacyMessage(value)
    return this.upsert(current?.legacy ? withParts(row.message, current.legacy) : row)
  }

  private upsert(value: Row) {
    if (this.boundary && order(value, this.boundary) < 0) return false
    const old = this.find(value.message.id)
    const size = this.textSize + this.size(value) - (old ? this.size(old) : 0)
    // Resnapshot at a durable boundary instead of inventing a Cloud cursor when a long-running view fills.
    if (size > 4 * 1024 * 1024 || (!old && this.rows.length >= 2 * PAGE_SIZE)) throw invalidResponse()
    this.remove(value.message.id)
    this.textSize = size
    this.rows.push(value)
    this.rows.sort(order)
    return true
  }

  private find(id: unknown) {
    return this.rows.find((row) => row.message.id === id)
  }

  private updatePart(row: Row | undefined, id: string, value: Content | undefined) {
    if (!row?.legacy) return false
    const items = [...row.legacy]
    const index = items.findIndex((p) => p.id === id)
    if (value) items[index < 0 ? items.length : index] = { id, value }
    else if (index >= 0) items.splice(index, 1)
    else return false
    if (items.length > 2048) throw invalidResponse()
    return this.upsert(withParts(row.message, items))
  }

  private append(value: ReturnType<typeof delta>) {
    if (value.field !== "text") return false
    const row = this.find(value.messageID)
    const previous = row?.legacy?.find((p) => p.id === value.partID)?.value
    if (!previous || previous.type === "tool") return false
    return this.updatePart(row, value.partID, { ...previous, text: previous.text + value.delta })
  }

  private remove(id: unknown) {
    const index = this.rows.findIndex((row) => row.message.id === id)
    if (index < 0) return false
    this.textSize -= this.size(this.rows.splice(index, 1)[0])
    return true
  }

  private size(row: Row) {
    return JSON.stringify(row.message).length
  }
}
