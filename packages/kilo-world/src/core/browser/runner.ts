import { existsSync, mkdirSync, rmSync } from "node:fs"
import childProcess, { type ChildProcess, type SpawnOptions, type SpawnSyncOptions } from "node:child_process"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright"
import { ensureHome, getConfig, setConfig } from "../../config"
import { Launch } from "./launch"
import { ANTI_DETECT } from "./detect"
import { Refs } from "./refs"
import { findSystemChrome } from "./chrome"
import type { BrowserCapability, SessionInfo, WorldConfigPatch } from "../../types"

type Live = {
  name: string
  context: BrowserContext
  browser: Browser
  active: Page
  home: string
}

let activeBrowser: Browser | null = null
let pending: Promise<Browser> | null = null
const activeContexts: Map<string, Live> = new Map()
const sessions: Map<string, SessionInfo> = new Map()

function home(): string {
  return ensureHome(getConfig().home)
}

function folder(home: string, name: string): string {
  const key = Buffer.from(name).toString("base64url") || "default"
  return join(home, "contexts", key)
}

function track(name: string, url?: string): void {
  const now = Date.now()
  const existing = sessions.get(name)
  sessions.set(name, {
    name,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
    ...(url ? { lastUrl: url } : {}),
  })
}

function buildLaunchOptions(): LaunchOptions {
  const opts = Launch.fromConfig(getConfig())
  const out: LaunchOptions = {
    headless: opts.headless,
    timeout: opts.timeoutMs,
    args: Launch.launchArgs(opts),
  }
  if (!opts.executablePath && !existsSync(chromium.executablePath())) {
    opts.executablePath = findSystemChrome()
  }
  if (opts.executablePath) {
    out.executablePath = opts.executablePath
  } else out.channel = Launch.channel(opts)
  return out
}

async function launch(timeout?: number): Promise<Browser> {
  const opts = buildLaunchOptions()
  if (timeout !== undefined) opts.timeout = timeout
  if (!Launch.hide(opts.headless === true)) return chromium.launch(opts)

  // Playwright's browser process launcher omits windowsHide. Unified headless
  // Chromium uses the full browser executable, but creates no visible browser
  // window, so hiding its console window is safe. Never apply this to headed
  // Chrome because windowsHide would also hide the browser window.
  type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  const api = childProcess as unknown as { spawn: Spawn; spawnSync: typeof childProcess.spawnSync }
  const spawn = api.spawn
  const sync = api.spawnSync
  api.spawn = (command, args, options) => spawn(command, args, { ...options, windowsHide: true })
  api.spawnSync = ((command: string, args?: readonly string[] | SpawnSyncOptions, options?: SpawnSyncOptions) => {
    if (Array.isArray(args)) return sync(command, args, { ...options, windowsHide: true })
    const opts = args as SpawnSyncOptions | undefined
    return sync(command, { ...opts, windowsHide: true })
  }) as typeof sync
  try {
    return await chromium.launch(opts)
  } finally {
    api.spawn = spawn
    api.spawnSync = sync
  }
}

export namespace Runner {
  export async function configure(cfg: WorldConfigPatch): Promise<void> {
    const current = Launch.fromConfig(getConfig())
    const next = Launch.fromConfig(setConfig(cfg))
    if (JSON.stringify(current) === JSON.stringify(next)) return
    await shutdown()
  }

  export function version(): string | undefined {
    return activeBrowser?.isConnected() ? activeBrowser.version() : undefined
  }
  export function listSessions(): SessionInfo[] {
    return Array.from(sessions.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  export async function ensureBrowser(timeout?: number): Promise<Browser> {
    if (activeBrowser && activeBrowser.isConnected()) return activeBrowser
    if (pending) return pending
    const task = launch(timeout).then((browser) => {
      activeBrowser = browser
      activeContexts.clear()
      browser.on("disconnected", () => {
        if (activeBrowser === browser) {
          activeBrowser = null
          activeContexts.clear()
          Refs.clear()
        }
      })
      return browser
    })
    const current = task.finally(() => {
      if (pending === current) pending = null
    })
    pending = current
    return current
  }

  export async function attach(name: string, timeout?: number): Promise<Live> {
    const existing = activeContexts.get(name)
    if (existing && existing.browser.isConnected()) {
      const page = existing.active.isClosed() ? existing.context.pages()[0] : existing.active
      if (page) {
        existing.active = page
        track(name, page.url())
        return existing
      }
      const fresh = await existing.context.newPage().catch(() => undefined)
      if (fresh) {
        existing.active = fresh
        track(name, fresh.url())
        return existing
      }
      activeContexts.delete(name)
      Refs.reset(name)
      await existing.context.close().catch(() => undefined)
    }
    const browser = await ensureBrowser(timeout)
    const opts = Launch.fromConfig(getConfig())
    const ctx = await browser.newContext(Launch.contextOptions(opts))
    const page = await (async () => {
      if (opts.antiDetect) await ctx.addInitScript(ANTI_DETECT)
      return ctx.newPage()
    })().catch(async (err) => {
      await ctx.close().catch(() => undefined)
      throw err
    })
    const live: Live = {
      name,
      context: ctx,
      browser,
      active: page,
      home: home(),
    }
    activeContexts.set(name, live)
    mkdirSync(folder(live.home, name), { recursive: true })
    track(name)
    return live
  }

  export async function close(name: string): Promise<boolean> {
    const live = activeContexts.get(name)
    if (!live) return false
    activeContexts.delete(name)
    sessions.delete(name)
    Refs.reset(name)
    await live.context.close()
    rmSync(folder(live.home, name), { recursive: true, force: true })
    return true
  }

  export async function shutdown(): Promise<void> {
    const launch = pending
    if (launch) await launch.catch(() => undefined)
    await Promise.allSettled(Array.from(activeContexts.values(), (live) => live.context.close()))
    activeContexts.clear()
    sessions.clear()
    Refs.clear()
    if (activeBrowser) {
      await activeBrowser.close()
      activeBrowser = null
    }
  }

  export function probeChromium(): Promise<BrowserCapability["installation"]> {
    const bundled = chromium.executablePath()
    const executable =
      getConfig().browser.executablePath ?? (existsSync(bundled) ? bundled : findSystemChrome()) ?? bundled
    if (existsSync(executable)) return Promise.resolve({ state: "available", message: executable })
    return Promise.resolve({
      state: "missing",
      message: `Chromium executable not found at ${executable}. Install with \`npx playwright install chromium\`.`,
    })
  }

  export function activePage(live: Live): Page {
    if (!live.active.isClosed()) return live.active
    const page = live.context.pages()[0]
    if (!page) throw new Error(`session ${live.name} has no active page`)
    live.active = page
    return page
  }

  export function touch(name: string, url?: string): void {
    track(name, url)
  }
}
