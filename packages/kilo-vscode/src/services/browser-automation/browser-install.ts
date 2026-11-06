import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { ChildProcess } from "child_process"
import { exec, spawn } from "../../util/process"
import { PLAYWRIGHT_MCP, PLAYWRIGHT_REVISIONS, type PlaywrightBrowser } from "./settings"

export type BrowserStatus = "installed" | "missing" | "unknown"

/** Browsers that Playwright downloads. Chrome and Edge are installed by the user instead. */
const BUILDS = ["chromium", "firefox", "webkit"] as const
type Build = (typeof BUILDS)[number]

/** One download of a build, as `playwright install --dry-run` lists it. */
interface Artifact {
  name: string
  dir: string
  url?: string
}

/** How much a missing build downloads, or how much an installed build takes on disk, in bytes. */
interface Size {
  download?: number
  disk?: number
}

/** Where an install is. A build is several files, and each is downloaded and then unpacked. */
interface Progress {
  /** Download percentage of the current file. At 100 the file is being unpacked. */
  percent: number
  /** Size of the file that is downloading. */
  bytes?: number
  /** Playwright's name of the current file, such as "Firefox 156.0". Unset until the first download starts. */
  name?: string
  /** Position of the current file among the files to download. */
  step?: number
  total?: number
}

/** Runs the Playwright CLI and resolves with its stdout. `output` receives stdout while the command runs. */
type Run = (args: string[], timeout: number, output?: (text: string) => void) => Promise<string>

interface Options {
  run?: Run
  exists?: (file: string) => boolean
  /** Size of a download in bytes, when the server reports it. */
  head?: (url: string) => Promise<number | undefined>
  /** Size of a directory tree in bytes. */
  measure?: (dir: string) => Promise<number>
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  home?: string
}

function build(browser: PlaywrightBrowser): browser is Build {
  return BUILDS.some((item) => item === browser)
}

/**
 * Run the Playwright CLI that belongs to the pinned Playwright MCP release.
 * Every Playwright version needs its own browser builds, so a plain
 * `npx playwright install` would fetch builds the MCP server cannot use.
 */
function npx(args: string[], timeout: number, output?: (text: string) => void): Promise<string> {
  const done = Promise.withResolvers<string>()
  // The package is usually in the npx cache already, because the MCP server runs from it.
  const child = spawn("npx", ["--prefer-offline", "-y", "-p", PLAYWRIGHT_MCP, "playwright", ...args], {
    // npx is a .cmd shim on Windows, which Node only starts through a shell. Every argument is a fixed string.
    shell: process.platform === "win32",
    // Its own process group on Unix, so a timeout can stop npx and the Playwright process it starts.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const out: string[] = []
  const err: string[] = []
  const state = { over: false }
  const timer = setTimeout(() => {
    state.over = true
    stop(child)
    done.reject(new Error("The Playwright command did not finish in time."))
  }, timeout)
  child.stdout?.on("data", (chunk: Buffer) => {
    if (state.over) return
    const text = chunk.toString("utf8")
    out.push(text)
    output?.(text)
  })
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk.toString("utf8")))
  child.on("error", (error) => done.reject(new Error(reason(error.message))))
  child.on("close", (code) => {
    if (code === 0) return done.resolve(out.join(""))
    done.reject(new Error(reason(err.join("") || out.join("") || `The Playwright command exited with code ${code}.`)))
  })
  return done.promise.finally(() => clearTimeout(timer))
}

/** Stop a command and every process it started. */
function stop(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === "win32") {
    // The shell runs npx, which runs Playwright, so only a tree kill reaches the download.
    void exec("taskkill", ["/pid", String(pid), "/T", "/F"]).catch((error: unknown) =>
      console.warn("[Kilo New] BrowserInstaller: could not stop the Playwright command:", error),
    )
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch (error) {
    console.warn("[Kilo New] BrowserInstaller: could not stop the Playwright command:", error)
  }
}

async function head(url: string): Promise<number | undefined> {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) })
  const value = Number(response.headers.get("content-length"))
  return response.ok && Number.isFinite(value) && value > 0 ? value : undefined
}

async function measure(dir: string): Promise<number> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return measure(file)
      if (!entry.isFile()) return 0
      return fs.promises.stat(file).then(
        (stat) => stat.size,
        () => 0,
      )
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

/** Reduce command output to the one line that says why it failed. */
export function reason(output: string): string {
  if (/spawn npx ENOENT|'npx' is not recognized|npx: (command )?not found/i.test(output)) {
    return "npx was not found. Install Node.js, then try again."
  }
  // Playwright can print a boxed notice about project dependencies, which is never the cause.
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[╔║╚]/.test(line))
  // An error line is followed by stack frames, so the last line alone would name a source location.
  const line = lines.find((item) => /^(\w*Error:|Failed to )/.test(item)) ?? lines.at(-1) ?? "The download failed."
  return line.replace(/^Error:\s*/, "").slice(0, 300)
}

/**
 * Move an install forward by one line of Playwright's output. Returns the same
 * object when the line changes nothing.
 */
export function advance(state: Progress, line: string): Progress {
  // Playwright dims the url with color codes when colors are on.
  const start = /^Downloading (.+?) \(playwright \S+ v\d+\)/.exec(line.replace(/\u001b\[[0-9;]*m/g, "").trim())
  if (start) return { name: start[1], step: (state.step ?? 0) + 1, total: state.total, percent: 0 }
  const match = /(\d{1,3})% of ([\d.]+) MiB/.exec(line)
  if (!match) return state
  const percent = Math.min(100, Number(match[1]))
  const size = Number(match[2])
  const bytes = Number.isFinite(size) ? Math.round(size * 1024 * 1024) : undefined
  if (percent === state.percent && bytes === state.bytes) return state
  return { ...state, percent, bytes }
}

/** Where the installed Chrome or Edge executable can be, following Playwright's own lookup. */
function candidates(
  browser: "chrome" | "msedge",
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === "win32") {
    const suffix =
      browser === "chrome"
        ? path.win32.join("Google", "Chrome", "Application", "chrome.exe")
        : path.win32.join("Microsoft", "Edge", "Application", "msedge.exe")
    return [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].flatMap((root) =>
      root ? [path.win32.join(root, suffix)] : [],
    )
  }
  if (platform === "darwin") {
    return [
      browser === "chrome"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
  }
  return [browser === "chrome" ? "/opt/google/chrome/chrome" : "/opt/microsoft/msedge/msedge"]
}

/**
 * The directories a build of the pinned release normally installs to, with the
 * browser itself first. Playwright uses another revision on a few older
 * systems, so a build that is not here still needs the dry-run lookup before it
 * counts as missing.
 */
function usual(browser: Build, platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string) {
  const join = platform === "win32" ? path.win32.join : path.posix.join
  const custom = env.PLAYWRIGHT_BROWSERS_PATH
  const root =
    custom && custom !== "0"
      ? custom
      : platform === "win32"
        ? join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ms-playwright")
        : platform === "darwin"
          ? join(home, "Library", "Caches", "ms-playwright")
          : join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "ms-playwright")
  const revision = PLAYWRIGHT_REVISIONS[browser]
  const main = join(root, `${browser}-${revision}`)
  // Chromium also unpacks a separate headless shell.
  return browser === "chromium" ? [main, join(root, `chromium_headless_shell-${revision}`)] : [main]
}

/** Whether a download belongs to this browser alone, unlike helpers such as ffmpeg that builds share. */
function own(browser: Build, artifact: Artifact): boolean {
  return artifact.name === browser || artifact.name === `${browser}-headless-shell`
}

/** Read the downloads of a build from `playwright install --dry-run <browser>`. */
export function artifacts(output: string): Artifact[] {
  const pattern =
    /\(playwright (\S+) v\d+\)[^\S\r\n]*\r?\n[^\S\r\n]*Install location:[^\S\r\n]*(.+?)[^\S\r\n]*(?:\r?\n[^\S\r\n]*Download url:[^\S\r\n]*(\S+))?(?:\r?\n|$)/g
  return [...output.matchAll(pattern)].flatMap((match) => {
    const name = match[1]
    const dir = match[2]
    if (!name || !dir) return []
    return [{ name, dir, url: match[3]?.startsWith("https://") ? match[3] : undefined }]
  })
}

/**
 * Reports which browsers Playwright browser automation can start, and installs
 * the Playwright builds that are missing. It never deletes a build.
 */
export class BrowserInstaller {
  private readonly run: Run
  private readonly exists: (file: string) => boolean
  private readonly head: (url: string) => Promise<number | undefined>
  private readonly measure: (dir: string) => Promise<number>
  private readonly platform: NodeJS.Platform
  private readonly env: Record<string, string | undefined>
  private readonly home: string
  private readonly lookups = new Map<Build, Promise<Artifact[]>>()
  private readonly downloads = new Map<string, Promise<number | undefined>>()
  private readonly disks = new Map<string, Promise<number>>()
  private readonly active = new Map<Build, Promise<void>>()
  private readonly percents = new Map<Build, Progress>()
  private readonly watchers = new Map<Build, Set<() => void>>()

  constructor(opts: Options = {}) {
    this.run = opts.run ?? npx
    this.exists = opts.exists ?? fs.existsSync
    this.head = opts.head ?? head
    this.measure = opts.measure ?? measure
    this.platform = opts.platform ?? process.platform
    this.env = opts.env ?? process.env
    this.home = opts.home ?? os.homedir()
  }

  private complete(dir: string): boolean {
    // Playwright writes this marker after a build is fully unpacked.
    return this.exists(path.join(dir, "INSTALLATION_COMPLETE"))
  }

  private usual(browser: Build): string[] {
    return usual(browser, this.platform, this.env, this.home)
  }

  private found(browser: Build): boolean {
    const dir = this.usual(browser).at(0)
    return !!dir && this.complete(dir)
  }

  /**
   * What is known without the slow lookup: Chrome and Edge, and builds found
   * in their usual directory. Other builds are left out until `status` resolves.
   */
  async known(): Promise<Partial<Record<PlaywrightBrowser, BrowserStatus>>> {
    const found: Partial<Record<PlaywrightBrowser, BrowserStatus>> = {
      chrome: await this.check("chrome"),
      msedge: await this.check("msedge"),
    }
    for (const item of BUILDS) {
      if (this.found(item)) found[item] = "installed"
    }
    return found
  }

  /** Builds that are being downloaded right now. */
  installing(): PlaywrightBrowser[] {
    return [...this.active.keys()]
  }

  async check(browser: PlaywrightBrowser): Promise<BrowserStatus> {
    if (!build(browser)) {
      return candidates(browser, this.platform, this.env).some((file) => this.exists(file)) ? "installed" : "missing"
    }
    if (this.found(browser)) return "installed"
    const main = (await this.resolve(browser)).find((item) => item.name === browser)
    if (!main) return "unknown"
    return this.complete(main.dir) ? "installed" : "missing"
  }

  async status(): Promise<Record<PlaywrightBrowser, BrowserStatus>> {
    const [chrome, chromium, msedge, firefox, webkit] = await Promise.all([
      this.check("chrome"),
      this.check("chromium"),
      this.check("msedge"),
      this.check("firefox"),
      this.check("webkit"),
    ])
    return { chrome, chromium, msedge, firefox, webkit }
  }

  /**
   * The download size of each missing build and the disk size of each
   * installed one. A size that cannot be read is left out.
   */
  async sizes(): Promise<Partial<Record<Build, Size>>> {
    const list = await Promise.all(BUILDS.map(async (item) => [item, await this.size(item)] as const))
    return Object.fromEntries(list)
  }

  private async size(browser: Build): Promise<Size> {
    const state = await this.check(browser)
    if (state === "installed") {
      const dirs = await this.dirs(browser)
      const disk = await Promise.all(dirs.filter((dir) => this.exists(dir)).map((dir) => this.disk(dir)))
      return { disk: disk.reduce((sum, value) => sum + value, 0) }
    }
    if (state !== "missing") return {}
    // Helpers that another build already installed are not downloaded again.
    const pending = (await this.resolve(browser)).filter((item) => !this.complete(item.dir))
    const parts = await Promise.all(pending.map((item) => (item.url ? this.download(item.url) : undefined)))
    if (parts.length === 0 || parts.some((value) => value === undefined)) return {}
    return { download: parts.reduce<number>((sum, value) => sum + (value ?? 0), 0) }
  }

  private download(url: string): Promise<number | undefined> {
    const cached = this.downloads.get(url)
    if (cached) return cached
    const task = this.head(url).catch((error: unknown) => {
      console.warn("[Kilo New] BrowserInstaller: could not read a download size:", error)
      this.downloads.delete(url)
      return undefined
    })
    this.downloads.set(url, task)
    return task
  }

  private disk(dir: string): Promise<number> {
    const cached = this.disks.get(dir)
    if (cached) return cached
    const task = this.measure(dir).catch((error: unknown) => {
      console.warn("[Kilo New] BrowserInstaller: could not measure a build:", error)
      this.disks.delete(dir)
      return 0
    })
    this.disks.set(dir, task)
    return task
  }

  /** The directories that hold this browser alone. Shared helpers such as ffmpeg are not included. */
  private async dirs(browser: Build): Promise<string[]> {
    if (this.found(browser)) return this.usual(browser)
    return (await this.resolve(browser)).filter((item) => own(browser, item)).map((item) => item.dir)
  }

  /** Progress of each build that is installing. */
  progress(): Partial<Record<Build, Progress>> {
    return Object.fromEntries(this.percents)
  }

  /**
   * Download a Playwright build. Concurrent requests for the same build share
   * one download. `watch` runs whenever the progress changes.
   */
  install(browser: PlaywrightBrowser, watch?: () => void): Promise<void> {
    if (!build(browser)) {
      return Promise.reject(new Error(`${browser} is not a Playwright build. Install it from its vendor.`))
    }
    const watchers = this.watchers.get(browser) ?? new Set()
    if (watch) watchers.add(watch)
    this.watchers.set(browser, watchers)
    const running = this.active.get(browser)
    if (running) return running
    const state = { over: false }
    const report = (value: Progress) => {
      // Output can still arrive while a timed-out command shuts down.
      if (state.over) return
      this.percents.set(browser, value)
      for (const item of watchers) item()
    }
    const task = this.resolve(browser)
      .then(async (list) => {
        // Files that are already installed are not downloaded again, so they do not count as steps.
        const total = list.filter((item) => !this.complete(item.dir)).length || undefined
        report({ percent: 0, total })
        // Output arrives in arbitrary chunks, so only complete lines are read.
        const pending = { text: "" }
        await this.run(["install", browser], 20 * 60_000, (text) => {
          const lines = (pending.text + text).split(/\r?\n/)
          pending.text = lines.pop() ?? ""
          for (const line of lines) {
            const last = this.percents.get(browser) ?? { percent: 0, total }
            const next = advance(last, line)
            if (next !== last) report(next)
          }
        })
      })
      .finally(() => {
        state.over = true
        this.active.delete(browser)
        this.percents.delete(browser)
        this.watchers.delete(browser)
        this.disks.clear()
      })
    this.active.set(browser, task)
    return task
  }

  // The downloads of a build depend only on the pinned release, so one successful lookup per build is enough.
  private resolve(browser: Build): Promise<Artifact[]> {
    const cached = this.lookups.get(browser)
    if (cached) return cached
    const task = this.run(["install", "--dry-run", browser], 180_000)
      .then(artifacts)
      .catch((error: unknown) => {
        console.warn("[Kilo New] BrowserInstaller: could not read Playwright build locations:", error)
        this.lookups.delete(browser)
        return []
      })
    this.lookups.set(browser, task)
    return task
  }
}

export const installer = new BrowserInstaller()
