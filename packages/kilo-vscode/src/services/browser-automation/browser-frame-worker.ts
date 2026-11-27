import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { URL } from "node:url"
import { parentPort, workerData, type MessagePort } from "node:worker_threads"
import WebSocket, { WebSocketServer, type RawData } from "ws"
import {
  decodeStreamInput,
  encodeStreamFrame,
  STREAM_CODECS,
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
  const parts = payload.split(":", 5)
  if (parts.length !== 5) return
  const prefix = parts[0].length + parts[1].length + parts[2].length + parts[3].length + parts[4].length + 5
  if (prefix > payload.length) return
  const epoch = Number(parts[0])
  const kind = parts[1]
  const codec = Number(parts[2])
  const cross = parts[3].indexOf("x")
  if (cross < 1) return
  const width = Number(parts[3].slice(0, cross))
  const height = Number(parts[3].slice(cross + 1))
  const timestamp = Number(parts[4])
  if (!Number.isSafeInteger(epoch) || !Number.isInteger(codec) || codec < 1 || codec >= STREAM_CODECS.length) return
  if (!Number.isFinite(timestamp)) return
  return { epoch, kind, codec, width, height, timestamp, b64: payload.slice(prefix) }
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
    private readonly options: Capture,
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

  private clearClientTimer(): void {
    if (!this.clientTimer) return
    clearTimeout(this.clientTimer)
    this.clientTimer = undefined
  }

  private closeOffscreen(): void {
    this.clearClientTimer()
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
    this.clearClientTimer()
    if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) this.clientWs.close(1001, "Replaced")
    this.clientWs = ws
    this.dropping = false
    if (this.offscreenBound && !this.forceJpeg) this.stopJpeg()
    this.sendInitialKey(ws)
    ws.on("message", (raw) => this.handleClientInput(raw))
    ws.on("close", () => {
      if (this.clientWs === ws) this.clientWs = undefined
    })
    ws.on("error", () => {
      if (this.clientWs === ws) ws.close()
    })
  }

  private requestKeyFrame(): void {
    if (!this.offscreenWs || this.offscreenWs.readyState !== WebSocket.OPEN) return
    this.sendOffscreen("Runtime.evaluate", { expression: "globalThis.__kiloKeyFrame?.()" })
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

  private isWheelReversed(input: { deltaX: number; deltaY: number }): boolean {
    if (input.deltaY !== 0 && this.lastWheelSignY !== 0 && Math.sign(input.deltaY) !== this.lastWheelSignY) return true
    return (
      Math.abs(input.deltaX) >= 4 &&
      Math.abs(input.deltaX) >= Math.abs(input.deltaY) &&
      this.lastWheelSignX !== 0 &&
      Math.sign(input.deltaX) !== this.lastWheelSignX
    )
  }

  private queueWheel(input: { x: number; y: number; deltaX: number; deltaY: number; modifiers: number }): void {
    const now = performance.now()
    const modChanged = this.queuedWheel !== undefined && this.queuedWheel.modifiers !== input.modifiers
    const posChanged =
      this.queuedWheel !== undefined && (this.queuedWheel.x !== input.x || this.queuedWheel.y !== input.y)
    // Flush on onset, direction reversal, or modifier change so start/reversal latency stays zero.
    if (this.isWheelReversed(input) || modChanged) {
      this.flushWheel()
      this.dispatchWheel(input)
      return
    }
    // Coordinates are an ordering barrier (matching mergeWheel), so flush the prior position before queuing the new one.
    if (posChanged) {
      this.flushWheel()
      this.queuedWheel = { x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY, modifiers: input.modifiers }
      this.wheelTimer = setTimeout(() => this.flushWheel(), WHEEL_INTERVAL)
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
        codec: parsed.codec,
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
    this.startStream(command)
  }

  private startStream(command: Extract<WorkerCommand, { type: "start" }>): void {
    this.view = command.view
    this.navigation = command.navigation
    this.committed = command.committed
    this.epoch = command.epoch
    this.active = true
    this.dropping = false
    this.cachedKey = undefined
    this.pendingHost = undefined
    if (command.offscreen && !this.forceJpeg) {
      this.stopJpeg()
      this.bindOffscreen(command.offscreen)
      if (!this.clientWs && !this.clientTimer) {
        // Start JPEG fallback after 800ms if direct WS hasn't attached; tear down unused H.264 if still unattached at 3s.
        this.clientTimer = setTimeout(() => {
          this.clientTimer = undefined
          if (this.clientWs || !this.active) return
          this.startJpeg()
          this.clientTimer = setTimeout(() => {
            this.clientTimer = undefined
            if (!this.clientWs && this.active) this.fallbackJpeg()
          }, 2200)
        }, 800)
      }
      return
    }
    this.closeOffscreen()
    this.startJpeg()
  }
}

if (parentPort) {
  new DirectCapture(parentPort, workerData as Capture)
}
