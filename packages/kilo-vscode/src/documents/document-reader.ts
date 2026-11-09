import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

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
 * directory. Compare folded on those platforms and exactly on Linux, where case
 * can name two real paths.
 */
export function isInsideWorktree(
  root: string,
  resolved: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const fold = platform === "win32" || platform === "darwin"
  const sep = platform === "win32" ? "\\" : "/"
  const base = fold ? root.toLowerCase() : root
  const target = fold ? resolved.toLowerCase() : resolved
  return target === base || target.startsWith(base + sep)
}

// The server's plan directory, which can differ from this process's paths (the isolated dev profile moves it).
let serverPlans: string | undefined

/** Read plans from the plan directory of the server this extension starts. */
export function usePlanDir(dir: string): void {
  serverPlans = dir
}

/** The server's global plan directory, the one place outside the worktree whose files the preview shows. */
export function plansDir(dir = serverPlans ?? dataPlans(process.env)): string {
  return dir
}

/** The plan directory in the Kilo data directory: `<XDG data>/kilo2/plans`. */
export function dataPlans(env: NodeJS.ProcessEnv, home = env.OPENCODE_TEST_HOME): string {
  const base = home ? path.join(home, ".local", "share") : (env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"))
  return path.join(base, "kilo2", "plans")
}

/** Whether `resolved` lives in the plan directory (realpath-folded for tmpfs/symlink cases). */
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

/** Resolve a document path against the worktree without reading its contents. */
export function resolveDocumentPath(
  root: string,
  file: string,
  options?: { quiet?: boolean },
): { file: string; resolved: string; size: number } | { error: string } {
  if (!file) return { error: "Invalid document path." }
  // Resolving a UNC path opens an outbound SMB connection on Windows, so reject it before any filesystem call.
  if (file.startsWith("\\\\") || file.startsWith("//")) return { error: "Document is outside the worktree." }

  try {
    const base = fs.realpathSync(root)
    const target = path.isAbsolute(file) ? file : path.resolve(root, file)
    // A bare plan name belongs to the plan directory when the worktree has no such file, because the model
    // often links the plan by its file name after writing it there. Inline candidates arrive as `./name`.
    const name = file.replace(/^\.[\\/]/, "")
    const bare = !path.isAbsolute(name) && !name.includes("/") && !name.includes("\\")
    const candidates = bare ? [target, path.join(plansDir(), name)] : [target]
    const resolved = candidates.reduce<string | undefined>((found, candidate) => {
      if (found) return found
      try {
        return fs.realpathSync(candidate)
      } catch {
        return undefined
      }
    }, undefined)
    if (!resolved) return { error: "Document could not be read." }
    const inside = isInsideWorktree(base, resolved)
    if (!inside && !isPlan(resolved)) return { error: "Document is outside the worktree." }

    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return { error: "Document is not a file." }

    const canonical = inside ? path.relative(base, resolved).split(path.sep).join("/") : resolved
    return { file: canonical, resolved, size: stat.size }
  } catch (error) {
    if (!options?.quiet) console.error("Cannot resolve document path:", error)
    return { error: "Document could not be read." }
  }
}

/** Whether `file` is a document this session may open, without logging a miss. */
export function documentExists(root: string, file: string): boolean {
  return !("error" in resolveDocumentPath(root, file, { quiet: true }))
}

export function readDocument(root: string, file: string): DocumentResult {
  const target = resolveDocumentPath(root, file)
  if ("error" in target) return target

  try {
    const type = mime(target.resolved)
    const limit = type ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    if (target.size > limit) return { error: "Document is too large to preview." }

    if (type)
      return { file: target.file, kind: "image", mime: type, data: fs.readFileSync(target.resolved).toString("base64") }

    const content = fs.readFileSync(target.resolved)
    if (content.includes(0)) return { error: "Binary files cannot be previewed." }
    return { file: target.file, kind: "text", content: content.toString("utf8") }
  } catch (error) {
    console.error("Cannot read document:", error)
    return { error: "Document could not be read." }
  }
}

export function isMarkdownPath(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}
