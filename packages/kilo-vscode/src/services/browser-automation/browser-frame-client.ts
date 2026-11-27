import { Worker } from "node:worker_threads"
import type { CDPSession } from "playwright-core"
import type { BrowserViewport } from "../../shared/browser-stream"
import type { BrowserCaptureExtension } from "./browser-capture-ext"
import type { Capture, CaptureMessage, Pixels, WorkerCommand } from "./browser-frame"

type Handshake = ReturnType<typeof Promise.withResolvers<void>>
type PendingReply = ReturnType<typeof Promise.withResolvers<boolean>>

export class BrowserFrameClient {
  private worker?: Worker
  private cancel?: () => void
  private retiring = Promise.resolve()
  private generation = 0
  private captureEpoch = 0
  private activeContext?: string
  private forceJpeg = false
  private h264Active = false
  private pendingBound?: { epoch: number; deferred: PendingReply }
  private pendingStarted?: { epoch: number; deferred: PendingReply }
  enabled = true

  constructor(
    private readonly port: number,
    private readonly failed: () => void,
    private readonly endpoint?: (url: string | undefined) => void,
    private readonly extension?: () => BrowserCaptureExtension | undefined,
  ) {}

  // A superseded attachment is handled by the next generation, never by starting a fallback for the old one.
  async start(
    session: CDPSession,
    view: BrowserViewport,
    identity: { navigation: number; committed?: number },
    receive: (frame: Pixels) => void,
  ): Promise<boolean> {
    if (this.worker) return true
    const generation = this.generation
    const ready = Promise.withResolvers<void>()
    this.cancel = ready.resolve
    const timeout = setTimeout(() => ready.reject(new Error("Capture worker startup timed out")), 5000)
    void this.connect(session, view, identity, generation, receive, ready).catch(ready.reject)
    try {
      await ready.promise
      return true
    } catch {
      if (generation !== this.generation) return true
      this.enabled = false
      await this.stop()
      return false
    } finally {
      clearTimeout(timeout)
      if (this.cancel === ready.resolve) this.cancel = undefined
    }
  }

  stop(): Promise<void> {
    this.generation++
    this.h264Active = false
    this.cancel?.()
    this.cancel = undefined
    this.pendingBound?.deferred.resolve(false)
    this.pendingBound = undefined
    this.pendingStarted?.deferred.resolve(false)
    this.pendingStarted = undefined
    this.endpoint?.(undefined)
    const ctx = this.activeContext
    this.activeContext = undefined
    if (ctx) void this.extension?.()?.stop(ctx)
    if (this.worker) this.retiring = this.worker.terminate().then(() => undefined)
    this.worker = undefined
    return this.retiring
  }

  private async connect(
    session: CDPSession,
    view: BrowserViewport,
    identity: { navigation: number; committed?: number },
    generation: number,
    receive: (frame: Pixels) => void,
    ready: Handshake,
  ) {
    await this.retiring
    if (generation !== this.generation) return
    const { targetInfo } = await session.send("Target.getTargetInfo")
    if (generation !== this.generation) return
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535 || !/^[\da-f]+$/i.test(targetInfo.targetId))
      throw new Error("Missing local capture target")

    const options: Capture = {
      port: this.port,
      target: targetInfo.targetId,
      direct: true,
      navigation: identity.navigation,
      committed: identity.committed,
    }
    // Resolve next to the bundled CommonJS host at runtime; Bun inlines __dirname from this source module.
    const resolve = require.resolve
    const worker = new Worker(resolve("./browser-frame-worker.js"), { workerData: options, execArgv: [] })
    this.worker = worker
    let started = false
    const workerReady = Promise.withResolvers<string>()
    const ctxId = targetInfo.browserContextId

    const fail = () => {
      if (this.worker !== worker) return
      workerReady.reject(new Error("Capture worker did not start"))
      if (!started) return ready.reject(new Error("Capture worker did not start"))
      this.enabled = false
      void this.stop()
      this.failed()
    }
    worker.once("error", fail)
    worker.once("exit", fail)
    worker.on("message", (message: CaptureMessage) =>
      this.handleMessage(worker, message, ctxId, receive, workerReady),
    )

    const url = await workerReady.promise
    if (this.worker !== worker || generation !== this.generation) return
    this.endpoint?.(url)

    const h264 = await this.tryStartH264(worker, view, identity, generation, ctxId)
    if (this.worker !== worker || generation !== this.generation) return
    if (h264) {
      started = true
      this.h264Active = true
      ready.resolve()
      return
    }
    const jpegOk = await this.startJpeg(worker, view, identity, generation)
    if (this.worker !== worker || generation !== this.generation) return
    if (!jpegOk) throw new Error("Capture worker failed to start JPEG screencast")
    started = true
    ready.resolve()
    this.scheduleUpgrade(worker, view, identity, generation, ctxId)
  }

  private handleMessage(
    worker: Worker,
    message: CaptureMessage,
    ctxId: string | undefined,
    receive: (frame: Pixels) => void,
    workerReady: ReturnType<typeof Promise.withResolvers<string>>,
  ): void {
    if (this.worker !== worker) return
    if (message === "ready") return
    if ("data" in message) {
      receive(message)
      if (this.worker === worker) worker.postMessage("credit")
      return
    }
    if (message.type === "ready") {
      workerReady.resolve(message.url)
      return
    }
    if (message.type === "bound" && this.pendingBound?.epoch === message.epoch) {
      const deferred = this.pendingBound.deferred
      this.pendingBound = undefined
      deferred.resolve(true)
      return
    }
    if (message.type === "started" && this.pendingStarted?.epoch === message.epoch) {
      const deferred = this.pendingStarted.deferred
      this.pendingStarted = undefined
      deferred.resolve(true)
      return
    }
    if (message.type === "fallback-jpeg") {
      this.forceJpeg = true
      this.h264Active = false
      if (ctxId) void this.extension?.()?.stop(ctxId)
    }
  }

  private async tryStartH264(
    worker: Worker,
    view: BrowserViewport,
    identity: { navigation: number; committed?: number },
    generation: number,
    ctxId: string | undefined,
  ): Promise<boolean> {
    const ext = this.extension?.()
    if (this.forceJpeg || !ext?.isReady || !ctxId) return false
    const epoch = ++this.captureEpoch
    const scale = view.scale ?? 1
    const handle = await ext.prepare(ctxId, Math.round(view.width * scale), Math.round(view.height * scale), epoch)
    if (!handle || this.worker !== worker || generation !== this.generation) return false
    const bound = Promise.withResolvers<boolean>()
    this.pendingBound = { epoch, deferred: bound }
    worker.postMessage({
      type: "start",
      view,
      navigation: identity.navigation,
      committed: identity.committed,
      epoch,
      offscreen: handle.offscreenTargetId,
      codec: 1,
    } satisfies WorkerCommand)
    if (!(await bound.promise) || this.worker !== worker || generation !== this.generation) return false
    const result = await ext.start(handle, epoch)
    if (!result || this.worker !== worker || generation !== this.generation) {
      void ext.stop(ctxId)
      return false
    }
    this.activeContext = ctxId
    return true
  }

  private startJpeg(
    worker: Worker,
    view: BrowserViewport,
    identity: { navigation: number; committed?: number },
    generation: number,
  ): Promise<boolean> {
    const epoch = ++this.captureEpoch
    const started = Promise.withResolvers<boolean>()
    this.pendingStarted = { epoch, deferred: started }
    worker.postMessage({
      type: "start",
      view,
      navigation: identity.navigation,
      committed: identity.committed,
      epoch,
    } satisfies WorkerCommand)
    return started.promise
  }

  private scheduleUpgrade(
    worker: Worker,
    view: BrowserViewport,
    identity: { navigation: number; committed?: number },
    generation: number,
    ctxId: string | undefined,
  ): void {
    const ext = this.extension?.()
    if (this.forceJpeg || this.h264Active || !ext || ext.isReady || !ctxId) return
    void ext.whenReady().then(async (ok) => {
      if (!ok || this.forceJpeg || this.h264Active || this.generation !== generation || this.worker !== worker) return
      // Upgrade in-place on the live worker so the WebSocket and wheel stream stay uninterrupted.
      const upgraded = await this.tryStartH264(worker, view, identity, generation, ctxId).catch(() => false)
      if (upgraded && this.generation === generation && this.worker === worker) {
        this.h264Active = true
        return
      }
      if (this.generation === generation && this.worker === worker) {
        void this.startJpeg(worker, view, identity, generation)
      }
    })
  }
}
