import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const MAX_TEXT_BYTES = 2_000_000
const MAX_IMAGE_BYTES = 5_000_000

export type DocumentResult =
  | { file: string; kind: "text"; content: string }
  | { file: string; kind: "image"; mime: string; data: string }
  | { error: string }

/**
 * Whether `resolved` is `root` or lives inside it.
 *
 * Windows and default macOS filesystems are case-insensitive, and
 * `fs.realpathSync` keeps the case of its input instead of normalizing it, so an
 * absolute file path can arrive with a different case than the session
 * directory. Compare folded on those platforms, matching the package's
 * `samePath` policy, and exactly on Linux, where case can name two real paths.
 */
export function isInsideWorktree(
  root: string,
  resolved: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const fold = platform === "win32" || platform === "darwin"
  const sep = platform === "win32" ? path.win32.sep : path.sep
  const base = fold ? root.toLowerCase() : root
  const target = fold ? resolved.toLowerCase() : resolved
  return target === base || target.startsWith(base + sep)
}

/**
 * Canonical plans dir for non-git projects, mirroring the CLI's
 * `Global.Path.data` resolution (`XDG_DATA_HOME` or `~/.local/share`, same
 * fallback pattern as `config-file.ts` and `cli-resources.ts`). For non-git
 * projects plan files legitimately live here, outside the worktree, and the
 * CLI's plan-file logic already admits the dir — see #14588.
 */
export function plansDir(dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")): string {
  return path.join(dataHome, "kilo", "plans")
}

/** Whether `resolved` lives in the canonical plans dir (realpath-folded for tmpfs/symlink cases). */
function isPlan(resolved: string): boolean {
  const dir = plansDir()
  if (!fs.existsSync(dir)) return false
  return isInsideWorktree(fs.realpathSync(dir), resolved)
}

function mime(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".svg") return "image/svg+xml"
  return undefined
}

export function readDocument(root: string, file: string): DocumentResult {
  if (!file) return { error: "Invalid document path." }

  try {
    const base = fs.realpathSync(root)
    const target = path.isAbsolute(file) ? file : path.resolve(root, file)
    const resolved = fs.realpathSync(target)
    const inside = isInsideWorktree(base, resolved)
    if (!inside && !isPlan(resolved)) return { error: "Document is outside the worktree." }

    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return { error: "Document is not a file." }

    const type = mime(resolved)
    const limit = type ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    if (stat.size > limit) return { error: "Document is too large to preview." }

    const relative = inside ? path.relative(base, resolved).split(path.sep).join("/") : resolved
    if (type) return { file: relative, kind: "image", mime: type, data: fs.readFileSync(resolved).toString("base64") }

    const content = fs.readFileSync(resolved)
    if (content.includes(0)) return { error: "Binary files cannot be previewed." }
    return { file: relative, kind: "text", content: content.toString("utf8") }
  } catch (error) {
    console.error("[Kilo New] AgentManagerProvider: Cannot read document:", error)
    return { error: "Document could not be read." }
  }
}
