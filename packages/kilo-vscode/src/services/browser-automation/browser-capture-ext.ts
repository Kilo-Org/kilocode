import { existsSync } from "node:fs"
import path from "node:path"
import type { Browser, CDPSession } from "playwright-core"
import { BrowserNetwork } from "./browser-network"

interface TargetInfo {
  targetId: string
  type: string
  url: string
  browserContextId?: string
}

export interface TabCaptureHandle {
  offscreenTargetId: string
  tabTargetId: string
  swTargetId: string
}

type SendRaw = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>

function tryResolve(id: string): string | undefined {
  try {
    const resolve = require.resolve
    return resolve(id)
  } catch {
    return undefined
  }
}

function extensionDir(): string | undefined {
  const host = tryResolve("./extension.js") ?? tryResolve("./browser-frame-worker.js")
  const candidates = [
    ...(host ? [path.join(path.dirname(host), "browser-capture-ext"), path.resolve(path.dirname(host), "../assets/browser-capture-ext")] : []),
    path.resolve(process.cwd(), "assets/browser-capture-ext"),
    path.resolve(process.cwd(), "packages/kilo-vscode/assets/browser-capture-ext"),
  ]
  return candidates.find((dir) => existsSync(path.join(dir, "manifest.json")))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class BrowserCaptureExtension {
  private readonly ready: Promise<boolean>
  private warmed = false
  private disposed = false

  private constructor(
    private readonly session: CDPSession,
    readonly id: string,
    private readonly log: (...args: unknown[]) => void,
  ) {
    this.ready = this.warmup()
      .then((ok) => {
        this.warmed = ok
        return ok
      })
      .catch((error: unknown) => {
        this.log("Browser capture encoder warmup failed", error)
        return false
      })
  }

  get isReady(): boolean {
    return this.warmed && !this.disposed
  }

  whenReady(): Promise<boolean> {
    return this.ready
  }

  static async load(browser: Browser, log: (...args: unknown[]) => void): Promise<BrowserCaptureExtension | undefined> {
    const dir = extensionDir()
    if (!dir) return
    let session: CDPSession | undefined
    try {
      session = await browser.newBrowserCDPSession()
      const send = session.send.bind(session) as unknown as SendRaw
      const result = await send("Extensions.loadUnpacked", { path: dir, enableInIncognito: true })
      const id = typeof result.id === "string" ? result.id : undefined
      if (!id) {
        await session.detach().catch(() => {})
        return
      }
      BrowserNetwork.allowExtension(browser, id)
      return new BrowserCaptureExtension(session, id, log)
    } catch {
      await session?.detach().catch(() => {})
      return
    }
  }

  async prepare(
    browserContextId: string,
    width: number,
    height: number,
    epoch: number,
  ): Promise<TabCaptureHandle | undefined> {
    if (this.disposed || !(await this.ready)) return
    const tab = await this.waitTarget(
      (item) =>
        item.type === "tab" &&
        item.browserContextId === browserContextId &&
        !item.url.startsWith("chrome-extension://"),
    )
    const sw = await this.waitTarget(
      (item) =>
        item.type === "service_worker" && item.browserContextId === browserContextId && item.url.includes(this.id),
    )
    if (!tab || !sw) return
    const prepared = await this.waitFunction(sw.targetId, "__kiloPrepare")
    if (!prepared) return
    await this.evaluate(sw.targetId, `__kiloPrepare(${Math.round(width)}, ${Math.round(height)}, ${epoch})`)
    const offscreen = await this.waitTarget(
      (item) => item.browserContextId === browserContextId && item.url.includes(`${this.id}/offscreen.html`),
    )
    if (!offscreen) return
    if (!(await this.waitFunction(offscreen.targetId, "__kiloStop"))) return
    return { offscreenTargetId: offscreen.targetId, tabTargetId: tab.targetId, swTargetId: sw.targetId }
  }

  async start(
    handle: TabCaptureHandle,
    epoch: number,
  ): Promise<{ width: number; height: number; codec: string } | undefined> {
    if (this.disposed) return
    const send = this.session.send.bind(this.session) as unknown as SendRaw
    await send("Extensions.triggerAction", { id: this.id, targetId: handle.tabTargetId })
    for (let attempt = 0; attempt < 60 && !this.disposed; attempt++) {
      const value = (await this.evaluate(handle.swTargetId, "__kiloResult")) as
        | { epoch?: number; ok?: boolean; width?: number; height?: number; codec?: string }
        | undefined
      if (value?.epoch === epoch) {
        if (value.ok && value.width && value.height && value.codec) {
          return { width: value.width, height: value.height, codec: value.codec }
        }
        return
      }
      await sleep(50)
    }
  }

  async stop(browserContextId: string): Promise<void> {
    if (this.disposed) return
    const offscreen = (await this.targets()).find(
      (item) => item.browserContextId === browserContextId && item.url.includes(`${this.id}/offscreen.html`),
    )
    if (offscreen) await this.evaluate(offscreen.targetId, "__kiloStop()").catch(() => {})
  }

  async keyFrame(browserContextId: string): Promise<void> {
    if (this.disposed) return
    const offscreen = (await this.targets()).find(
      (item) => item.browserContextId === browserContextId && item.url.includes(`${this.id}/offscreen.html`),
    )
    if (offscreen) await this.evaluate(offscreen.targetId, "__kiloKeyFrame()").catch(() => {})
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    void this.session.detach().catch(() => {})
  }

  private async warmup(): Promise<boolean> {
    const offscreen = await this.waitTarget((item) => item.url.includes(`${this.id}/offscreen.html`), 60)
    if (!offscreen) return false
    if (!(await this.waitFunction(offscreen.targetId, "__kiloWarmup"))) return false
    const result = (await this.evaluate(offscreen.targetId, "__kiloWarmup()")) as { supported?: boolean } | undefined
    return result?.supported === true
  }

  private async waitFunction(targetId: string, name: string): Promise<boolean> {
    for (let attempt = 0; attempt < 40 && !this.disposed; attempt++) {
      const ready = await this.evaluate(targetId, `typeof globalThis.${name} === "function"`).catch(() => false)
      if (ready === true) return true
      await sleep(30)
    }
    return false
  }

  private async targets(): Promise<TargetInfo[]> {
    const send = this.session.send.bind(this.session) as unknown as SendRaw
    const result = await send("Target.getTargets", { filter: [{}] })
    return (result.targetInfos as TargetInfo[] | undefined) ?? []
  }

  private async waitTarget(match: (item: TargetInfo) => boolean, attempts = 50): Promise<TargetInfo | undefined> {
    for (let attempt = 0; attempt < attempts && !this.disposed; attempt++) {
      const found = (await this.targets()).find(match)
      if (found) return found
      await sleep(50)
    }
  }

  private async evaluate(targetId: string, expression: string): Promise<unknown> {
    const { sessionId } = await this.session.send("Target.attachToTarget", { targetId, flatten: false })
    try {
      return await this.sendEval(sessionId, expression)
    } finally {
      await this.session.send("Target.detachFromTarget", { sessionId }).catch(() => {})
    }
  }

  private sendEval(sessionId: string, expression: string): Promise<unknown> {
    const id = 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.session.off("Target.receivedMessageFromTarget", receive)
        reject(new Error("Capture extension evaluation timed out"))
      }, 10_000)
      const receive = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return
        const parsed = JSON.parse(event.message) as {
          id?: number
          error?: { message: string }
          result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } }
        }
        if (parsed.id !== id) return
        clearTimeout(timer)
        this.session.off("Target.receivedMessageFromTarget", receive)
        if (parsed.error) return reject(new Error(parsed.error.message))
        if (parsed.result?.exceptionDetails) return reject(new Error(parsed.result.exceptionDetails.text ?? "eval error"))
        resolve(parsed.result?.result?.value)
      }
      this.session.on("Target.receivedMessageFromTarget", receive)
      void this.session
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        })
        .catch((error: unknown) => {
          clearTimeout(timer)
          this.session.off("Target.receivedMessageFromTarget", receive)
          reject(error)
        })
    })
  }
}
