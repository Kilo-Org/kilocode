// Whether the browser tools can run right now, as the Settings panel shows it. The Playwright backend needs a Chrome,
// an Edge or the Chromium build `kilo browser install-chromium` writes into the server's data directory; the extension
// backend needs a browser that connected to a hub. Both paths are read from disk, so the answer costs no server call.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** Which executable the Playwright backend starts: a system channel, or the Chromium the CLI installed. */
export type Target = "chrome" | "msedge" | "chromium"

export type Status = {
  playwright: { ready: boolean; target?: Target }
  extension: { connected: boolean }
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

/** True while a hub that an extension can connect to is registered and its process is alive. */
export function extensionConnected(input: Input): boolean {
  const env = input.env ?? process.env
  const read: Reader = { ...reader, ...input.reader }
  const directory = hubsDirectory(input.state, env)
  let entries: string[]
  try {
    entries = read.entries(directory)
  } catch {
    return false
  }
  return entries.some((entry) => {
    if (!entry.endsWith(".json")) return false
    try {
      const record = JSON.parse(read.text(path.join(directory, entry))) as { pid?: unknown }
      return typeof record.pid === "number" && read.alive(record.pid)
    } catch {
      return false
    }
  })
}

export function status(input: Input): Status {
  const target = systemBrowser(input)
  const read: Reader = { ...reader, ...input.reader }
  const found =
    target ?? (installedChromium(input.data, input.platform ?? process.platform, read) ? "chromium" : undefined)
  return {
    playwright: found ? { ready: true, target: found } : { ready: false },
    extension: { connected: extensionConnected(input) },
  }
}
