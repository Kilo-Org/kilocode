import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { scheduler } from "node:timers/promises"
import { invalidResponse } from "./live-io.js"

type Target = KiloHostedRpc.Target
export type OpenBroadcast = (target: Target, control: string, signal: AbortSignal) => Promise<WebSocket>
const record = Schema.Record(Schema.String, Schema.Unknown)
const object = Schema.is(record)
const event = Schema.Struct({ type: Schema.String, properties: record })
const isEvent = Schema.is(event)
type Event = typeof event.Type
const Frame = Schema.Struct({
  sessionId: Schema.String,
  streamEventType: Schema.String,
  data: Schema.Unknown,
  eventId: Schema.Int,
  cursor: Schema.optional(Schema.Int),
})
const envelope = Schema.decodeUnknownOption(Schema.fromJsonString(Frame))
const delivery = [
  "cloud.message.queued",
  "cloud.message.sent",
  "cloud.message.canceled",
  "cloud.message.completed",
  "cloud.message.failed",
]
export const broadcastTypes = ["kilocode", ...delivery].join(",")
const messageID = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/
const source = Schema.is(
  Schema.Struct({ version: Schema.Literal("v2"), session: Schema.Struct({ id: Schema.String }) }),
)
const fragment = Schema.is(
  Schema.Struct({
    type: Schema.String,
    data: Schema.Struct({ sessionID: Schema.String, assistantMessageID: Schema.String }),
  }),
)

function subject(e: Event, root: string) {
  const p = e.properties
  if (p.sessionID !== undefined && p.sessionID !== root) return
  if (e.type.startsWith("conversation.")) return conversationSubject(e, root)
  switch (e.type) {
    case "message.updated":
      if (object(p.info) && p.info.sessionID === root) return key("message", p.info.id, true)
      return
    case "message.part.updated":
      if (object(p.part) && p.part.sessionID === root) return key("part", p.part.id, true)
      return
    case "message.part.delta":
    case "message.part.removed":
      if (p.sessionID === root) return key("part", p.partID, false)
      return
    case "message.removed":
      if (p.sessionID === root) return key("message", p.messageID, false)
      return
  }
}

function conversationSubject(e: Event, root: string) {
  const p = e.properties
  if (p.sessionID !== root) return
  if (
    e.type === "conversation.message.updated" &&
    source(p.source) &&
    p.source.session.id === root &&
    object(p.message)
  )
    return key("message", p.message.id, true)
  if (e.type === "conversation.event" && fragment(p.event) && p.event.data.sessionID === root)
    return key("message", p.event.data.assistantMessageID, p.event.type === "session.step.started")
}

function key(kind: string, id: unknown, checkpoint: boolean) {
  if (typeof id === "string" && id.length > 0 && id.length <= 255) return { id: `${kind}:${id}`, checkpoint }
}

/** Handoff at a whole message/part, never at an additive delta. A socket established mid-step
 * cannot append fragments already included in the native snapshot. The facade retains all control events. */
export class Broadcast {
  private readonly owned = new Set<string>()
  private readonly versions = new Map<number, number>()
  private readonly seen = new Set<string>()
  constructor(private readonly root: string) {}

  native(raw: unknown) {
    if (!this.owned.size || !isEvent(raw)) return true
    if (delivery.includes(raw.type)) return !this.owned.has(`queue:${raw.properties.messageId}`)
    const item = subject(raw, this.root)
    return !item || !this.owned.has(item.id)
  }

  private consume(frame: typeof Frame.Type, apply: (event: Event) => boolean) {
    if (frame.streamEventType !== "kilocode" || !isEvent(frame.data)) return
    const e = frame.data
    const item = subject(e, this.root)
    if (!item || (!item.checkpoint && !this.owned.has(item.id))) return
    // Row IDs are stable across upserts; only a mutation revision can disambiguate two updates.
    if (frame.eventId > 0 && frame.cursor !== undefined) {
      if ((this.versions.get(frame.eventId) ?? -1) >= frame.cursor) return
      this.versions.set(frame.eventId, frame.cursor)
    }
    if (e.type === "conversation.event" && object(e.properties.event) && typeof e.properties.event.id === "string") {
      const id = e.properties.event.id
      if (this.seen.has(id)) return
      this.seen.add(id)
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!)
    }
    if (
      apply({
        type: e.type,
        properties: { ...e.properties, sessionID: this.root, directory: `/cloud-agent/sessions/${this.root}` },
      })
    )
      this.owned.add(item.id)
    if (this.owned.size > 4096 || this.versions.size > 4096) throw invalidResponse()
  }

  private delivery(frame: typeof Frame.Type, apply: (event: Event) => boolean) {
    if (!delivery.includes(frame.streamEventType) || !object(frame.data)) return
    const d = frame.data
    if ([d.sessionID, d.kiloSessionId].some((id) => id !== undefined && id !== this.root)) return
    if (typeof d.messageId !== "string" || !messageID.test(d.messageId)) return
    this.owned.add(`queue:${d.messageId}`)
    if (this.owned.size > 4096) throw invalidResponse()
    apply({ type: frame.streamEventType, properties: { sessionID: this.root, messageId: d.messageId } })
  }

  async follow(
    open: OpenBroadcast,
    target: Target,
    control: string,
    signal: AbortSignal,
    apply: (e: Event) => boolean,
    resnapshot: () => void,
  ) {
    while (!signal.aborted) {
      await this.connect(open, target, control, signal, apply).catch(() => {})
      if (signal.aborted) return
      // The native tail may have already skipped broadcast-owned deltas; rebuild across a fresh fence.
      if (this.owned.size) return resnapshot()
      await scheduler.wait(30_000, { signal }).catch(() => {})
    }
  }

  private async connect(
    open: OpenBroadcast,
    target: Target,
    control: string,
    signal: AbortSignal,
    apply: (e: Event) => boolean,
  ) {
    const ws = await open(target, control, AbortSignal.any([signal, AbortSignal.timeout(8000)]))
    const ended = Promise.withResolvers<void>()
    const finish = () => ended.resolve()
    let ready = false
    const timer = setTimeout(finish, 8000)
    try {
      signal.throwIfAborted()
      signal.addEventListener("abort", finish, { once: true })
      ws.onclose = ws.onerror = finish
      ws.onmessage = (message) => {
        if (signal.aborted) return
        if (typeof message.data !== "string" || Buffer.byteLength(message.data) > 2_000_000) return finish()
        const parsed = envelope(message.data)
        if (parsed._tag === "None" || parsed.value.sessionId !== control) return
        if (parsed.value.streamEventType === "bootstrap.complete") {
          ready = true
          clearTimeout(timer)
        }
        try {
          if (ready) this.consume(parsed.value, apply)
          this.delivery(parsed.value, apply)
        } catch {
          finish()
        }
      }
      await ended.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      ws.onmessage = ws.onclose = ws.onerror = null
      ws.close()
    }
  }
}
