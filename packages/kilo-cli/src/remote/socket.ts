import { Buffer } from "node:buffer"
import { Schema } from "effect"

const Envelope = Schema.Struct({
  v: Schema.Literal(1),
  channel: Schema.Literals(["events", "commands", "control"]),
  seq: Schema.Number,
  from: Schema.String,
  at: Schema.Number,
  type: Schema.String,
  body: Schema.Unknown,
})
export type RemoteEnvelope = typeof Envelope.Type

export interface RemoteWebSocket extends EventTarget {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type RemoteWebSocketConstructor = new (
  url: string,
  options: { headers: Record<string, string> },
) => RemoteWebSocket

export type RemoteSocketOptions = {
  url: string
  ticket: () => Promise<{ ticket: string; expiresAt: string }>
  onFrame: (frame: RemoteEnvelope) => void | Promise<void>
  onState?: (connected: boolean) => void
  terminalReplacement?: boolean
  socket?: RemoteWebSocketConstructor
}

const decodeEnvelope = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope))
const decodeSchedule = Schema.decodeUnknownOption(
  Schema.Struct({
    expiresAt: Schema.optional(Schema.String),
    reauthAt: Schema.optional(Schema.String),
    reconnectAfterMs: Schema.optional(Schema.Number),
  }),
)
const limit = 65_536

/** Authenticated ephemeral transport; durable admission and replay belong to the caller. */
export class RemoteSocket {
  private active = false
  private generation = 0
  private ws?: RemoteWebSocket
  private retry?: ReturnType<typeof setTimeout>
  private renewal?: ReturnType<typeof setTimeout>
  private expiry?: ReturnType<typeof setTimeout>
  private reconnectAfterMs = 1000
  private renewing = false
  private online = false
  private readonly url: string

  constructor(private readonly options: RemoteSocketOptions) {
    const url = new URL(options.url)
    if (url.protocol === "https:") url.protocol = "wss:"
    if (url.protocol === "http:") url.protocol = "ws:"
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Invalid remote WebSocket protocol")
    if (url.username || url.password) throw new Error("Remote WebSocket URL must not contain credentials")
    this.url = url.toString()
  }

  get connected() {
    return this.online
  }

  start(): void {
    if (this.active) return
    this.active = true
    void this.connect(++this.generation)
  }

  stop(): void {
    this.active = false
    this.generation++
    clearTimeout(this.retry)
    this.clearAuthorization()
    const ws = this.ws
    this.ws = undefined
    this.state(false)
    ws?.close(1000, "Stopped")
  }

  send(frame: unknown): boolean {
    if (!this.online || !this.ws || this.ws.readyState !== 1) return false
    try {
      const text = JSON.stringify(frame)
      if (text === undefined || Buffer.byteLength(text) > limit) return false
      this.ws.send(text)
      return true
    } catch {
      return false
    }
  }

  private async connect(generation: number): Promise<void> {
    try {
      const ticket = await this.options.ticket()
      if (!this.active || generation !== this.generation) return
      const expiresAt = Date.parse(ticket.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Expired remote ticket")
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Bun supports handshake headers beyond the browser constructor's type.
      const Constructor = this.options.socket ?? (WebSocket as unknown as RemoteWebSocketConstructor)
      const ws = new Constructor(this.url, { headers: { Authorization: `Bearer ${ticket.ticket}` } })
      this.ws = ws
      this.authorize(ws, expiresAt, expiresAt - 30_000)
      let pending = Promise.resolve()
      ws.addEventListener("open", () => {
        if (this.ws === ws) this.state(true)
      })
      ws.addEventListener("message", (event) => {
        if (this.ws !== ws || !(event instanceof MessageEvent)) return
        if (typeof event.data !== "string" || Buffer.byteLength(event.data) > limit) {
          this.disconnect(ws, 1009)
          return
        }
        const frame = decodeEnvelope(event.data)
        if (frame._tag === "None") {
          this.disconnect(ws, 1002)
          return
        }
        this.control(ws, frame.value)
        pending = pending
          .then(async () => {
            if (this.ws === ws) await this.options.onFrame(frame.value)
          })
          .catch(() => this.disconnect(ws, 1011))
      })
      ws.addEventListener("close", (event) => this.disconnect(ws, event instanceof CloseEvent ? event.code : 1006))
      ws.addEventListener("error", () => this.disconnect(ws, 1011))
    } catch {
      if (this.active && generation === this.generation) this.reconnect()
    }
  }

  private control(ws: RemoteWebSocket, frame: RemoteEnvelope): void {
    if (frame.channel !== "control") return
    if (frame.type === "reauth_required") {
      void this.renew(ws)
      return
    }
    if (frame.type !== "hello" && frame.type !== "reauthorized") return
    const schedule = decodeSchedule(frame.body)
    if (schedule._tag === "None") return
    const body = schedule.value
    if (body.reconnectAfterMs !== undefined && Number.isFinite(body.reconnectAfterMs)) {
      this.reconnectAfterMs = Math.max(1000, Math.min(60_000, body.reconnectAfterMs))
    }
    const expiresAt = Date.parse(body.expiresAt ?? "")
    if (!Number.isFinite(expiresAt)) return
    const reauthAt = Date.parse(body.reauthAt ?? "")
    this.authorize(ws, expiresAt, Number.isFinite(reauthAt) ? reauthAt : expiresAt - 30_000)
  }

  private authorize(ws: RemoteWebSocket, expiresAt: number, reauthAt: number): void {
    clearTimeout(this.expiry)
    clearTimeout(this.renewal)
    this.expiry = setTimeout(() => this.disconnect(ws, 1008), Math.max(0, expiresAt - Date.now()))
    this.renewal = setTimeout(() => void this.renew(ws), Math.max(0, Math.min(reauthAt, expiresAt - 1000) - Date.now()))
  }

  private async renew(ws: RemoteWebSocket): Promise<void> {
    if (this.ws !== ws || this.renewing || !this.online) return
    this.renewing = true
    try {
      const ticket = await this.options.ticket()
      if (this.ws !== ws) return
      if (!(Date.parse(ticket.expiresAt) > Date.now()) || !this.send({ type: "reauth", ticket: ticket.ticket })) {
        this.disconnect(ws, 1008)
      }
      // Only reauthorized extends the old authorization deadline.
    } catch {
      this.disconnect(ws, 1008)
    } finally {
      if (this.ws === ws) this.renewing = false
    }
  }

  private disconnect(ws: RemoteWebSocket, code: number): void {
    if (this.ws !== ws) return
    this.ws = undefined
    this.clearAuthorization()
    this.state(false)
    if (code === 4009 && this.options.terminalReplacement) this.active = false
    if (ws.readyState < 2) ws.close(1000)
    if (this.active) this.reconnect()
  }

  private reconnect(): void {
    clearTimeout(this.retry)
    // The hint is a floor, not a synchronized retry deadline.
    const delay = this.reconnectAfterMs + Math.floor(Math.random() * this.reconnectAfterMs)
    this.retry = setTimeout(() => {
      if (this.active) void this.connect(this.generation)
    }, delay)
  }

  private clearAuthorization(): void {
    clearTimeout(this.renewal)
    clearTimeout(this.expiry)
    this.renewing = false
  }

  private state(connected: boolean): void {
    if (this.online === connected) return
    this.online = connected
    this.options.onState?.(connected)
  }
}
