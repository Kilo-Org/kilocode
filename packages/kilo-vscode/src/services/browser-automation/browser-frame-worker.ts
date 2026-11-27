import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { URL } from "node:url"
import { parentPort, workerData, type MessagePort } from "node:worker_threads"
import WebSocket, { WebSocketServer, type RawData } from "ws"
import {
  decodeStreamInput,
  encodeStreamFrame,
  STREAM_FRAME_H264_DELTA,
  STREAM_FRAME_H264_KEY,
  STREAM_FRAME_JPEG,
  STREAM_INPUT_FALLBACK_JPEG,
  STREAM_INPUT_KEYFRAME,
  STREAM_INPUT_WHEEL,
  type BrowserViewport,
} from "../../shared/browser-stream"
import { orderedFrames, screencast, type Capture, type Cast, type Pixels, type WorkerCommand } from "./browser-frame"
import { SCROLL_HELPER, SCROLL_WORLD } from "./browser-scroll"

const MAX_CHUNK = 2 * 1024 * 1024
const H264_BUFFER_CAP = 2 * 1024 * 1024
const JPEG_BUFFER_CAP = 256 * 1024
const WHEEL_INTERVAL = 16

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function rawBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return new Uint8Array(data)
}

function parseChunk(payload: string) {
  const i1 = payload.indexOf(":")
  const i2 = payload.indexOf(":", i1 + 1)
  const i3 = payload.indexOf(":", i2 + 1)
  const i4 = payload.indexOf(":", i3 + 1)
  if (i1 < 1 || i2 < 0 || i3 < 0 || i4 < 0) return
  const epoch = Number(payload.slice(0, i1))
  const kind = payload.slice(i1 + 1, i2)
  const size = payload.slice(i2 + 1, i3)
  const cross = size.indexOf("x")
  if (cross < 1) return
  const width = Number(size.slice(0, cross))
  const height = Number(size.slice(cross + 1))
  const timestamp = Number(payload.slice(i3 + 1, i4))
  if (!Number.isSafeInteger(epoch) || !Number.isFinite(timestamp)) return
  return { epoch, kind, width, height, timestamp, b64: payload.slice(i4 + 1) }
}

function legacyCapture(parent: MessagePort, options: Extract<Capture, { direct?: false }>) {
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}/devtools/page/${options.target}`, {
    perMessageDeflate: false,
  })
  let id = 0
  let start = 0
  let pending: Pixels | undefined
  let credit = true
  const decode = orderedFrames()

  const send = (method: string, params?: object) => {
    socket.send(JSON.stringify({ id: ++id, method, params }))
    return id
  }
  const drain = () => {
    if (!pending || !credit) return
    credit = false
    parent.postMessage(pending, [pending.data])
    pending = undefined
  }
  parent.on("message", () => {
    credit = true
    drain()
  })
  socket.on("open", () => {
    send("Page.enable")
    start = send("Page.startScreencast", screencast(options.view))
  })
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as { id?: number; error?: unknown; method?: string; params: Cast }
    if (message.id === start) {
      if (message.error) return process.exit(1)
      parent.postMessage("ready")
      return
    }
    if (message.method === "Inspector.detached") return process.exit(0)
    if (message.method !== "Page.screencastFrame") return
    send("Page.screencastFrameAck", { sessionId: message.params.sessionId })
    const frame = decode(message.params, options.view)
    if (!frame) return
    pending = frame
    drain()
  })
  socket.on("error", () => process.exit(1))
  socket.on("close", () => process.exit(0))
}

class DirectCapture {
  private readonly secret = randomBytes(32).toString("hex")
  private readonly server = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  private readonly wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 })
  private readonly targetWs: WebSocket
  private wsPort = 0
  private targetReady = false
  private readySent = false
  private clientWs?: WebSocket
  private offscreenWs?: WebSocket
  private offscreenId?: string
  private offscreenBound = false
  private targetCmd = 0
  private startJpegCmd = 0
  private offscreenCmd = 0
  private bindCmd = 0
  private sequence = 0
  private epoch = 0
  private navigation: number
  private committed?: number
  private codec = 1
  private active = false
  private castingJpeg = false
  private forceJpeg = false
  private dropping = false
  private view?: BrowserViewport
  private decode = orderedFrames()
  private pendingHost?: Pixels
  private hostCredit = true
  private cachedKey?: { epoch: number; navigation: number; revision: number; packet: Uint8Array }
  private clientTimer?: ReturnType<typeof setTimeout>
  private wheelTimer?: ReturnType<typeof setTimeout>
  private lastWheelSent = 0
  private lastWheelSignY = 0
  private lastWheelSignX = 0
  private queuedWheel?: { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  private scrollContextId?: number
  private mainFrameId?: string
  private frameTreeCmd = 0
  private readonly scrollContexts = new Map<string, number>()
  private readonly pendingScroll = new Map<
    number,
    { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  >()

  constructor(
    private readonly parent: MessagePort,
    private readonly options: Extract<Capture, { direct: true }>,
  ) {
    this.navigation = options.navigation
    this.committed = options.committed
    this.targetWs = new WebSocket(`ws://127.0.0.1:${options.port}/devtools/page/${options.target}`, {
      perMessageDeflate: false,
    })
    this.setup()
  }

  private setup(): void {
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head))
    this.server.on("error", () => process.exit(1))
    this.server.listen(0, "127.0.0.1", () => {
      const addr = this.server.address()
      if (!addr || typeof addr === "string") return process.exit(1)
      this.wsPort = addr.port
      this.maybeReady()
    })
    this.targetWs.on("open", () => {
      this.sendTarget("Page.enable")
      this.frameTreeCmd = this.sendTarget("Page.getFrameTree")
      this.sendTarget("Runtime.enable")
      this.sendTarget("Page.addScriptToEvaluateOnNewDocument", {
        source: SCROLL_HELPER,
        worldName: SCROLL_WORLD,
        runImmediately: true,
      })
      this.targetReady = true
      this.maybeReady()
    })
    this.targetWs.on("message", (raw) => this.handleTargetMessage(raw))
    this.targetWs.on("error", () => process.exit(1))
    this.targetWs.on("close", () => process.exit(0))
    this.parent.on("message", (command: WorkerCommand) => this.handleCommand(command))
  }

  private canDeliver(): boolean {
    return this.active && !!this.view && (this.committed === undefined || this.committed === this.navigation)
  }

  private sendTarget(method: string, params?: object): number {
    if (this.targetWs.readyState !== WebSocket.OPEN) return 0
    const id = ++this.targetCmd
    this.targetWs.send(JSON.stringify({ id, method, params }))
    return id
  }

  private sendOffscreen(method: string, params?: object): number {
    if (!this.offscreenWs || this.offscreenWs.readyState !== WebSocket.OPEN) return 0
    const id = ++this.offscreenCmd
    this.offscreenWs.send(JSON.stringify({ id, method, params }))
    return id
  }

  private maybeReady(): void {
    if (this.readySent || !this.wsPort || !this.targetReady) return
    this.readySent = true
    this.parent.postMessage({ type: "ready", url: `ws://127.0.0.1:${this.wsPort}/stream/${this.secret}` })
  }

  private drainHost(): void {
    if (!this.pendingHost || !this.hostCredit) return
    this.hostCredit = false
    this.parent.postMessage(this.pendingHost, [this.pendingHost.data])
    this.pendingHost = undefined
  }

  private stopJpeg(): void {
    if (!this.castingJpeg) return
    this.castingJpeg = false
    this.startJpegCmd = 0
    this.sendTarget("Page.stopScreencast")
  }

  private startJpeg(): void {
    if (!this.active || !this.view || this.castingJpeg) return
    this.castingJpeg = true
    this.decode = orderedFrames()
    this.startJpegCmd = this.sendTarget("Page.startScreencast", screencast(this.view))
  }

  private closeOffscreen(): void {
    this.offscreenBound = false
    this.offscreenId = undefined
    const ws = this.offscreenWs
    this.offscreenWs = undefined
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
  }

  private fallbackJpeg(): void {
    if (!this.forceJpeg) {
      this.forceJpeg = true
      this.parent.postMessage({ type: "fallback-jpeg" })
    }
    this.closeOffscreen()
    this.cachedKey = undefined
    this.startJpeg()
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (req.headers.host !== `127.0.0.1:${this.wsPort}`) return rejectUpgrade(socket, 403, "Forbidden")
    if (!(req.headers.origin ?? "").startsWith("vscode-webview://")) return rejectUpgrade(socket, 403, "Forbidden")
    let parsed: URL
    try {
      parsed = new URL(req.url ?? "/", `http://127.0.0.1:${this.wsPort}`)
    } catch {
      return rejectUpgrade(socket, 400, "Bad Request")
    }
    const prefix = "/stream/"
    if (!parsed.pathname.startsWith(prefix) || !sameSecret(parsed.pathname.slice(prefix.length), this.secret)) {
      return rejectUpgrade(socket, 401, "Unauthorized")
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attachClient(ws))
  }

  private attachClient(ws: WebSocket): void {
    if (this.clientTimer) {
      clearTimeout(this.clientTimer)
      this.clientTimer = undefined
    }
    if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) this.clientWs.close(1001, "Replaced")
    this.clientWs = ws
    this.dropping = false
    this.parent.postMessage({ type: "client", connected: true })
    if (this.offscreenBound && !this.forceJpeg) this.stopJpeg()
    this.sendInitialKey(ws)
    ws.on("message", (raw) => this.handleClientInput(raw))
    ws.on("close", () => {
      if (this.clientWs !== ws) return
      this.clientWs = undefined
      this.parent.postMessage({ type: "client", connected: false })
    })
    ws.on("error", () => {
      if (this.clientWs === ws) ws.close()
    })
  }

  private requestKeyFrame(): void {
    if (!this.offscreenWs || this.offscreenWs.readyState !== WebSocket.OPEN) return
    this.sendOffscreen("Runtime.evaluate", { expression: "globalThis.__kiloKeyFrame?.()" })
  }

  private clearWheel(): void {
    if (this.wheelTimer) {
      clearTimeout(this.wheelTimer)
      this.wheelTimer = undefined
    }
    this.queuedWheel = undefined
  }

  private flushWheel(): void {
    if (this.wheelTimer) {
      clearTimeout(this.wheelTimer)
      this.wheelTimer = undefined
    }
    const item = this.queuedWheel
    this.queuedWheel = undefined
    if (!item || !this.canDeliver() || !this.view) return
    this.dispatchWheel(item)
  }

  private dispatchNativeWheel(item: { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }): void {
    if (!this.view) return
    this.sendTarget("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.min(this.view.width - 1, item.x * this.view.width),
      y: Math.min(this.view.height - 1, item.y * this.view.height),
      modifiers: item.modifiers,
      buttons: 0,
      deltaX: item.deltaX,
      deltaY: item.deltaY,
    })
  }

  private dispatchWheel(item: { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }): void {
    if (!this.view) return
    this.lastWheelSent = performance.now()
    if (item.deltaY !== 0) this.lastWheelSignY = Math.sign(item.deltaY)
    if (Math.abs(item.deltaX) >= 4 && Math.abs(item.deltaX) >= Math.abs(item.deltaY)) {
      this.lastWheelSignX = Math.sign(item.deltaX)
    }
    if (this.scrollContextId === undefined || item.modifiers & 2) {
      this.dispatchNativeWheel(item)
      return
    }
    const px = Math.min(this.view.width - 1, item.x * this.view.width)
    const py = Math.min(this.view.height - 1, item.y * this.view.height)
    const id = this.sendTarget("Runtime.evaluate", {
      contextId: this.scrollContextId,
      expression: `globalThis.__kiloScroll?.(${px},${py},${item.deltaX},${item.deltaY},${item.modifiers})`,
      returnByValue: true,
    })
    if (id) {
      if (this.pendingScroll.size > 32) this.pendingScroll.clear()
      this.pendingScroll.set(id, item)
    }
  }

  private queueWheel(input: { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }): void {
    const now = performance.now()
    const reversedY = input.deltaY !== 0 && this.lastWheelSignY !== 0 && Math.sign(input.deltaY) !== this.lastWheelSignY
    const reversedX =
      Math.abs(input.deltaX) >= 4 &&
      Math.abs(input.deltaX) >= Math.abs(input.deltaY) &&
      this.lastWheelSignX !== 0 &&
      Math.sign(input.deltaX) !== this.lastWheelSignX
    const modChanged = this.queuedWheel !== undefined && this.queuedWheel.modifiers !== input.modifiers
    // Flush on onset, direction reversal, or modifier change so start/reversal latency stays zero.
    if (reversedY || reversedX || modChanged) {
      this.flushWheel()
      this.dispatchWheel(input)
      return
    }
    if (!this.queuedWheel && now - this.lastWheelSent >= WHEEL_INTERVAL) {
      this.dispatchWheel(input)
      return
    }
    const nextX = (this.queuedWheel?.deltaX ?? 0) + input.deltaX
    const nextY = (this.queuedWheel?.deltaY ?? 0) + input.deltaY
    if (Math.abs(nextX) > 10000 || Math.abs(nextY) > 10000) {
      this.flushWheel()
      this.dispatchWheel(input)
      return
    }
    this.queuedWheel = { x: input.x, y: input.y, deltaX: nextX, deltaY: nextY, modifiers: input.modifiers }
    if (!this.wheelTimer) {
      const wait = Math.max(1, Math.round(WHEEL_INTERVAL - (now - this.lastWheelSent)))
      this.wheelTimer = setTimeout(() => this.flushWheel(), wait)
    }
  }

  private sendInitialKey(ws: WebSocket): void {
    const cached = this.cachedKey
    const matches =
      cached &&
      this.canDeliver() &&
      this.view &&
      cached.epoch === this.epoch &&
      cached.navigation === this.navigation &&
      cached.revision === this.view.revision
    if (matches) {
      ws.send(cached.packet, { binary: true })
      return
    }
    if (this.active && !this.forceJpeg && this.offscreenBound) this.requestKeyFrame()
  }

  private handleClientInput(raw: RawData): void {
    const input = decodeStreamInput(rawBytes(raw))
    if (!input) return
    if (input.kind === STREAM_INPUT_FALLBACK_JPEG) return this.fallbackJpeg()
    if (input.kind === STREAM_INPUT_KEYFRAME) {
      this.requestKeyFrame()
      return
    }
    if (input.kind !== STREAM_INPUT_WHEEL) return
    if (!this.canDeliver() || !this.view || input.navigation !== this.navigation || input.revision !== this.view.revision)
      return
    this.queueWheel(input)
  }

  private handleScrollReply(message: {
    id?: number
    error?: unknown
    result?: { result?: { value?: unknown }; exceptionDetails?: unknown; frameTree?: { frame?: { id?: string } } }
  }): boolean {
    if (message.id && message.id === this.frameTreeCmd) {
      this.frameTreeCmd = 0
      const frameId = message.result?.frameTree?.frame?.id
      if (typeof frameId === "string") {
        this.mainFrameId = frameId
        this.scrollContextId = this.scrollContexts.get(frameId)
      }
      return true
    }
    if (!message.id || !this.pendingScroll.has(message.id)) return false
    const item = this.pendingScroll.get(message.id)!
    this.pendingScroll.delete(message.id)
    const ok = !message.error && !message.result?.exceptionDetails && message.result?.result?.value === true
    if (!ok && this.canDeliver()) this.dispatchNativeWheel(item)
    return true
  }

  private handleScrollContext(message: {
    method?: string
    params?: {
      context?: { id?: number; name?: string; auxData?: { frameId?: string } }
      executionContextId?: number
    }
  }): boolean {
    if (message.method === "Runtime.executionContextCreated" && message.params?.context?.name === SCROLL_WORLD) {
      const id = message.params.context.id
      const frameId = message.params.context.auxData?.frameId
      if (typeof id === "number" && typeof frameId === "string") {
        this.scrollContexts.set(frameId, id)
        if (frameId === this.mainFrameId) this.scrollContextId = id
      }
      return true
    }
    if (message.method === "Runtime.executionContextDestroyed") {
      const id = message.params?.executionContextId
      if (id === this.scrollContextId) this.scrollContextId = undefined
      for (const [frameId, ctxId] of this.scrollContexts) if (ctxId === id) this.scrollContexts.delete(frameId)
      return true
    }
    if (message.method === "Runtime.executionContextsCleared") {
      this.scrollContextId = undefined
      this.scrollContexts.clear()
      this.pendingScroll.clear()
      return true
    }
    return false
  }

  private handleTargetMessage(raw: RawData): void {
    const message = JSON.parse(raw.toString()) as {
      id?: number
      error?: unknown
      result?: { result?: { value?: unknown }; exceptionDetails?: unknown; frameTree?: { frame?: { id?: string } } }
      method?: string
      params: Cast & {
        context?: { id?: number; name?: string; auxData?: { frameId?: string } }
        executionContextId?: number
      }
    }
    if (message.id && message.id === this.startJpegCmd) {
      this.startJpegCmd = 0
      if (message.error) return process.exit(1)
      this.parent.postMessage({ type: "started", epoch: this.epoch })
      return
    }
    if (this.handleScrollReply(message) || this.handleScrollContext(message)) return
    if (message.method === "Inspector.detached") return process.exit(0)
    if (message.method !== "Page.screencastFrame") return
    this.sendTarget("Page.screencastFrameAck", { sessionId: message.params.sessionId })
    if (!this.canDeliver() || !this.view) return
    const frame = this.decode(message.params, this.view)
    if (!frame) return
    if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
      if (this.clientWs.bufferedAmount > JPEG_BUFFER_CAP) return
      const packet = encodeStreamFrame(
        {
          kind: STREAM_FRAME_JPEG,
          codec: 0,
          width: frame.width,
          height: frame.height,
          navigation: this.navigation,
          revision: this.view.revision,
          sequence: ++this.sequence,
          timestamp: performance.now() * 1000,
        },
        new Uint8Array(frame.data),
      )
      this.clientWs.send(packet, { binary: true })
      return
    }
    this.pendingHost = frame
    this.drainHost()
  }

  private bindOffscreen(targetId: string): void {
    if (this.offscreenWs && this.offscreenId === targetId && this.offscreenWs.readyState === WebSocket.OPEN && this.offscreenBound) {
      this.parent.postMessage({ type: "bound", epoch: this.epoch })
      return
    }
    this.closeOffscreen()
    this.offscreenId = targetId
    const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/devtools/page/${targetId}`, {
      perMessageDeflate: false,
    })
    this.offscreenWs = ws
    ws.on("open", () => {
      if (this.offscreenWs !== ws) return
      this.sendOffscreen("Runtime.enable")
      this.bindCmd = this.sendOffscreen("Runtime.addBinding", { name: "__kiloChunk" })
    })
    ws.on("message", (raw) => this.handleOffscreenMessage(raw))
    ws.on("error", () => {
      if (this.offscreenWs === ws) this.fallbackJpeg()
    })
    ws.on("close", () => {
      if (this.offscreenWs === ws && this.active && !this.forceJpeg) this.fallbackJpeg()
    })
  }

  private handleOffscreenMessage(raw: RawData): void {
    const message = JSON.parse(raw.toString()) as {
      id?: number
      error?: unknown
      method?: string
      params?: { name?: string; payload?: string }
    }
    if (message.id && message.id === this.bindCmd) {
      if (message.error) return this.fallbackJpeg()
      this.offscreenBound = true
      this.parent.postMessage({ type: "bound", epoch: this.epoch })
      return
    }
    if (message.method !== "Runtime.bindingCalled" || message.params?.name !== "__kiloChunk") return
    this.handleChunk(message.params.payload ?? "")
  }

  private handleChunk(payload: string): void {
    const parsed = parseChunk(payload)
    if (!parsed || parsed.epoch !== this.epoch || !this.canDeliver() || !this.view) return
    if (parsed.kind === "e") return this.fallbackJpeg()
    if ((parsed.kind !== "k" && parsed.kind !== "d") || parsed.width <= 0 || parsed.height <= 0) return
    const bytes = Buffer.from(parsed.b64, "base64")
    if (!bytes.byteLength || bytes.byteLength > MAX_CHUNK) return
    const kind = parsed.kind === "k" ? STREAM_FRAME_H264_KEY : STREAM_FRAME_H264_DELTA
    const packet = encodeStreamFrame(
      {
        kind,
        codec: this.codec,
        width: parsed.width,
        height: parsed.height,
        navigation: this.navigation,
        revision: this.view.revision,
        sequence: ++this.sequence,
        timestamp: parsed.timestamp,
      },
      bytes,
    )
    if (kind === STREAM_FRAME_H264_KEY) {
      this.cachedKey = { epoch: this.epoch, navigation: this.navigation, revision: this.view.revision, packet }
    }
    this.sendH264(kind, packet)
  }

  private sendH264(kind: 1 | 2, packet: Uint8Array): void {
    if (!this.clientWs || this.clientWs.readyState !== WebSocket.OPEN) return
    if (this.clientWs.bufferedAmount > H264_BUFFER_CAP && kind === STREAM_FRAME_H264_DELTA) {
      if (!this.dropping) {
        this.dropping = true
        this.requestKeyFrame()
      }
      return
    }
    if (this.dropping && kind === STREAM_FRAME_H264_DELTA) return
    this.dropping = false
    this.clientWs.send(packet, { binary: true })
  }

  private handleCommand(command: WorkerCommand): void {
    if (command === "credit") {
      this.hostCredit = true
      this.drainHost()
      return
    }
    if (command.type === "close") return this.shutdown()
    if (command.type === "stop") {
      this.active = false
      this.epoch = command.epoch
      this.cachedKey = undefined
      this.pendingHost = undefined
      this.clearWheel()
      this.stopJpeg()
      return
    }
    if (command.type === "gate") {
      this.navigation = command.navigation
      this.committed = command.committed
      this.epoch = command.epoch
      this.cachedKey = undefined
      this.pendingHost = undefined
      this.clearWheel()
      return
    }
    this.startStream(command)
  }

  private startStream(command: Extract<WorkerCommand, { type: "start" }>): void {
    this.view = command.view
    this.navigation = command.navigation
    this.committed = command.committed
    this.epoch = command.epoch
    this.codec = command.codec ?? 1
    this.active = true
    this.dropping = false
    this.cachedKey = undefined
    this.pendingHost = undefined
    if (command.offscreen && !this.forceJpeg) {
      this.stopJpeg()
      this.bindOffscreen(command.offscreen)
      if (!this.clientWs && !this.clientTimer) {
        // Fall back to host postMessage JPEG if the webview cannot reach loopback WS (e.g. remote host).
        this.clientTimer = setTimeout(() => {
          this.clientTimer = undefined
          if (!this.clientWs && this.active) this.startJpeg()
        }, 800)
      }
      return
    }
    this.startJpeg()
  }

  private shutdown(): void {
    if (this.clientTimer) clearTimeout(this.clientTimer)
    this.clearWheel()
    this.clientWs?.close(1001, "Closed")
    this.closeOffscreen()
    this.stopJpeg()
    this.targetWs.close()
    this.wss.close()
    this.server.close()
    process.exit(0)
  }
}

if (parentPort) {
  const options = workerData as Capture
  if (options.direct) new DirectCapture(parentPort, options)
  else legacyCapture(parentPort, options)
}
