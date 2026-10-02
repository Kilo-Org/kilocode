/**
 * Resolve an organization avatar for a project from its Git origin remote.
 *
 * The image is downloaded once and kept in a disk cache, then sent to the
 * webview as a data URL. The sidebar shows it at once on later loads and
 * also when the network is not available.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const DAY = 24 * 60 * 60 * 1000
/** How long to wait before retrying an avatar that failed to download. */
const RETRY = 5 * 60 * 1000
const owners = new Map<string, string | undefined>()
const images = new Map<string, string>()
const pending = new Set<string>()
const failed = new Map<string, number>()

function config(root: string): string | undefined {
  const dot = path.join(root, ".git")
  const stat = fs.statSync(dot, { throwIfNoEntry: false })
  if (!stat) return undefined
  if (stat.isDirectory()) return path.join(dot, "config")
  const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"))
  if (!match) return undefined
  const dir = path.resolve(root, match[1].trim())
  const common = path.join(dir, "commondir")
  if (!fs.existsSync(common)) return path.join(dir, "config")
  return path.join(path.resolve(dir, fs.readFileSync(common, "utf8").trim()), "config")
}

/** Parse the owner of a GitHub remote URL. SSH host aliases such as github.com-work are accepted. */
export function owner(url: string): string | undefined {
  const match = /github\.com[^:/\s]*[:/]([^/\s]+)\//i.exec(url)
  return match?.[1]
}

/** GitHub owner of the project's origin remote, cached per root. */
export function origin(root: string): string | undefined {
  if (owners.has(root)) return owners.get(root)
  const file = config(root)
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const section = /\[remote "origin"\]([^[]*)/.exec(text)?.[1] ?? ""
  const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim()
  const name = url ? owner(url) : undefined
  owners.set(root, name)
  return name
}

function dir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
  return path.join(base, "kilo", "project-avatars")
}

function file(name: string) {
  return path.join(dir(), `${name.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}.png`)
}

async function download(name: string, done: () => void, log: (msg: string) => void) {
  if (pending.has(name)) return
  pending.add(name)
  try {
    // Request and accept PNG only, so the disk cache matches the image/png data URL.
    const res = await fetch(`https://github.com/${encodeURIComponent(name)}.png?size=64`)
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.startsWith("image/png")) {
      failed.set(name, Date.now())
      return
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.mkdir(dir(), { recursive: true })
    await fs.promises.writeFile(file(name), buf)
    images.set(name, `data:${type};base64,${buf.toString("base64")}`)
    failed.delete(name)
    done()
  } catch (err) {
    // Offline or a transient write failure. Remember the failure so later
    // renders do not retry on every push, and clear `pending` in `finally`.
    failed.set(name, Date.now())
    log(`avatar: failed to load ${name}: ${err}`)
  } finally {
    pending.delete(name)
  }
}

/**
 * Avatar data URL for a project, or undefined while it is not cached yet.
 * A missing or stale cache entry starts a download; `done` runs when a new image is ready.
 * Download failures are reported through `log`. Never throws: an unreadable
 * `.git` or cache file falls back to the letter tile.
 */
export function avatar(
  root: string,
  done: () => void = () => {},
  log: (msg: string) => void = () => {},
): string | undefined {
  try {
    const name = origin(root)
    if (!name) return undefined
    const cached = images.get(name)
    if (cached) return cached
    const entry = file(name)
    const stat = fs.statSync(entry, { throwIfNoEntry: false })
    if (stat) {
      const url = `data:image/png;base64,${fs.readFileSync(entry).toString("base64")}`
      images.set(name, url)
      if (Date.now() - stat.mtimeMs > 7 * DAY) void download(name, done, log)
      return url
    }
    const retryAt = failed.get(name)
    if (retryAt !== undefined && Date.now() - retryAt < RETRY) return undefined
    void download(name, done, log)
    return undefined
  } catch (err) {
    log(`avatar: failed to read avatar for ${root}: ${err}`)
    return undefined
  }
}
