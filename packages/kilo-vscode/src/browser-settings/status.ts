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
export function systemBrowser(input: Input): Target | undefined {
  const platform = input.platform ?? process.platform
  const home = input.home ?? os.homedir()
  const env = input.env ?? process.env
  const exists = input.reader?.exists ?? reader.exists
  const candidates = (list: (string | undefined)[]) => list.filter((item): item is string => Boolean(item))
  if (candidates(chromePaths(platform, home, env)).some(exists)) return "chrome"
  if (candidates(edgePaths(platform, home, env)).some(exists)) return "msedge"
  return undefined
}

/**
 * Whether `kilo browser install-chromium` wrote a Chromium into the server's data directory. The revision directory
 * name belongs to the pinned playwright-core, so any `chromium-*` build counts.
 */
export function installedChromium(data: string, read: Reader = reader): boolean {
  const directory = path.join(data, "browser", "browsers")
  try {
    return read.entries(directory).some((entry) => entry.startsWith("chromium"))
  } catch {
    return false
  }
}

/**
 * The hub registry of the browser extension (`SPEC` § Transport): each hub writes `<run dir>/hubs/<hubId>.json` and
 * removes it on exit. It is written by the browser hub, which ships after these settings; until one runs, no
 * extension is connected.
 */
export function hubsDirectory(
  platform: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "kilo", "browser", "run", "hubs")
  if (platform === "win32") return undefined
  const runtime = env.XDG_RUNTIME_DIR
  return runtime ? path.join(runtime, "kilo-browser", "hubs") : undefined
}

/** True while a hub that an extension can connect to is registered and its process is alive. */
export function extensionConnected(input: Input): boolean {
  const platform = input.platform ?? process.platform
  const home = input.home ?? os.homedir()
  const env = input.env ?? process.env
  const read: Reader = { ...reader, ...input.reader }
  const directory = hubsDirectory(platform, home, env)
  if (!directory) return false
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
  const found = target ?? (installedChromium(input.data, { ...reader, ...input.reader }) ? "chromium" : undefined)
  return {
    playwright: found ? { ready: true, target: found } : { ready: false },
    extension: { connected: extensionConnected(input) },
  }
}
