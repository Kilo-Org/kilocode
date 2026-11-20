// Whether the browser tools can run right now, as the Settings panel shows it. The Playwright backend needs a Chrome,
// an Edge or the Chromium build `kilo browser install-chromium` writes into the server's data directory; the extension
// backend needs a browser extension connected to a hub. Both are read from disk (the hub registry records the connected
// extension), so the answer costs no server call and never dials a hub.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** Which executable the Playwright backend starts: a system channel, or the Chromium the CLI installed. */
export type Target = "chrome" | "msedge" | "chromium"

/**
 * The browser extension as the hub registry reports it: no hub running, a hub with no extension connected yet, or the
 * browser and profile of the extension connected to it.
 */
export type Extension =
  | { state: "none" }
  | { state: "waiting" }
  | { state: "connected"; browser: string; profile?: string }

export type Status = {
  playwright: { ready: boolean; target?: Target }
  extension: Extension
}

/** The filesystem reads, injectable so a test can describe a machine instead of having one. */
export type Reader = {
  exists: (file: string) => boolean
  entries: (directory: string) => string[]
  text: (file: string) => string
  /** True while the process exists. A hub registry entry whose pid is gone is a hub that exited without cleaning up. */
  alive: (pid: number) => boolean
}

export type Input = {
  /** `Global.Path.data` of the spawned server: `resolveDataDir` of the extension host. */
  data: string
  /** `Global.Path.state` of the spawned server, where `Paths.run()` of the CLI puts the hub registry. */
  state: string
  platform?: NodeJS.Platform
  home?: string
  env?: Record<string, string | undefined>
  reader?: Partial<Reader>
}

const reader: Reader = {
  exists: existsSync,
  entries: (directory) => readdirSync(directory),
  text: (file) => readFileSync(file, "utf8"),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
}

// The same search order as `packages/kilo-plugin/src/browser/locate.ts`: system Chrome, system Edge, then the
// Chromium the CLI installed. The extension must not import the plugin, so the list lives here too.
function chromePaths(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>) {
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
  if (platform === "win32")
    return [
      env.PROGRAMFILES && path.win32.join(env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      env["PROGRAMFILES(X86)"] && path.win32.join(env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    ]
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"]
}

function edgePaths(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>) {
  if (platform === "darwin")
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]
  if (platform === "win32")
    return [
      env.PROGRAMFILES && path.win32.join(env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
      env["PROGRAMFILES(X86)"] && path.win32.join(env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe"),
    ]
  return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"]
}

/** The system browser the Playwright backend prefers, when one is installed. */
export function systemBrowser(input: Omit<Input, "data" | "state">): Target | undefined {
  const platform = input.platform ?? process.platform
  const home = input.home ?? os.homedir()
  const env = input.env ?? process.env
  const exists = input.reader?.exists ?? reader.exists
  const candidates = (list: (string | undefined)[]) => list.filter((item): item is string => Boolean(item))
  if (candidates(chromePaths(platform, home, env)).some(exists)) return "chrome"
  if (candidates(edgePaths(platform, home, env)).some(exists)) return "msedge"
  return undefined
}

/** The Chromium executable inside a `chromium-<revision>` directory, for each platform playwright-core ships. */
const EXECUTABLE: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  win32: "chrome-win/chrome.exe",
  linux: "chrome-linux/chrome",
}

/**
 * Whether `kilo browser install-chromium` wrote a complete Chromium into the server's data directory. The CLI
 * (`packages/kilo-plugin/src/browser/install.ts`) extracts the build into `<data>/browser/browsers/chromium-<revision>`
 * and writes `INSTALLATION_COMPLETE` after chmodding the executable, which is what its own installer checks before it
 * downloads again; the plugin's `locate.ts` then starts that executable. A stray or half-extracted directory with no
 * executable is not installed.
 */
export function installedChromium(
  data: string,
  platform: NodeJS.Platform = process.platform,
  read: Reader = reader,
): boolean {
  const executable = EXECUTABLE[platform]
  if (!executable) return false
  const directory = path.join(data, "browser", "browsers")
  try {
    return read.entries(directory).some((entry) => {
      if (!/^chromium-\d+$/.test(entry)) return false
      const build = path.join(directory, entry)
      return read.exists(path.join(build, "INSTALLATION_COMPLETE")) && read.exists(path.join(build, executable))
    })
  } catch {
    return false
  }
}

/**
 * The hub registry of the browser extension (`SPEC` § Transport): each hub writes `<run dir>/hubs/<hubId>.json` and
 * removes it on exit. The CLI's `Paths.hubs()` puts the run dir under the state dir, not the data dir, and lets
 * `KILO_BROWSER_RUN_DIR` move it; this mirrors both (`packages/kilo-cli/src/browser/paths.ts`).
 */
export function hubsDirectory(state: string, env: Record<string, string | undefined> = process.env): string {
  const run = env.KILO_BROWSER_RUN_DIR || path.join(state, "browser", "run")
  return path.join(run, "hubs")
}

/**
 * The extension as the live hubs report it. A hub writes the connected extension's browser and profile into its entry
 * on every connect and clears them on disconnect (`packages/kilo-cli/src/browser/hub.ts` `onChange`), so an entry with
 * a live pid and no browser is a hub waiting for an extension: unpaired, or with "Allow local agents" off.
 */
export function extensionStatus(input: Input): Extension {
  const env = input.env ?? process.env
  const read: Reader = { ...reader, ...input.reader }
  const directory = hubsDirectory(input.state, env)
  const hubs = entriesOf(read, directory).flatMap((entry) => {
    if (!entry.endsWith(".json")) return []
    const hub = hubOf(read, path.join(directory, entry))
    return hub && read.alive(hub.pid) ? [hub] : []
  })
  const connected = hubs.find((hub) => hub.browser !== undefined)
  if (connected?.browser !== undefined)
    return {
      state: "connected",
      browser: connected.browser,
      ...(connected.profile ? { profile: connected.profile } : {}),
    }
  return hubs.length > 0 ? { state: "waiting" } : { state: "none" }
}

function entriesOf(read: Reader, directory: string) {
  try {
    return read.entries(directory)
  } catch {
    return []
  }
}

/** One registry entry (`packages/kilo-cli/src/browser/registry.ts` `Entry`): the fields the status needs, or nothing. */
function hubOf(read: Reader, file: string): { pid: number; browser?: string; profile?: string } | undefined {
  const value = parsed(read, file)
  if (typeof value !== "object" || value === null) return undefined
  const entry: { pid?: unknown; browser?: unknown; profileLabel?: unknown } = value
  if (typeof entry.pid !== "number") return undefined
  const browser =
    typeof entry.browser === "object" && entry.browser !== null && "name" in entry.browser
      ? entry.browser.name
      : undefined
  return {
    pid: entry.pid,
    ...(typeof browser === "string" && browser ? { browser } : {}),
    ...(typeof entry.profileLabel === "string" && entry.profileLabel ? { profile: entry.profileLabel } : {}),
  }
}

function parsed(read: Reader, file: string): unknown {
  try {
    return JSON.parse(read.text(file))
  } catch {
    return undefined
  }
}

export function status(input: Input): Status {
  const target = systemBrowser(input)
  const read: Reader = { ...reader, ...input.reader }
  const found =
    target ?? (installedChromium(input.data, input.platform ?? process.platform, read) ? "chromium" : undefined)
  return {
    playwright: found ? { ready: true, target: found } : { ready: false },
    extension: extensionStatus(input),
  }
}
