import * as fs from "fs"
import * as path from "path"

const MAX_TEXT_BYTES = 2_000_000
const MAX_IMAGE_BYTES = 5_000_000

export type DocumentResult =
  | { file: string; kind: "text"; content: string }
  | { file: string; kind: "image"; mime: string; data: string }
  | { error: string }

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
    if (resolved !== base && !resolved.startsWith(base + path.sep))
      return { error: "Document is outside the worktree." }

    const stat = fs.statSync(resolved)
    if (!stat.isFile()) return { error: "Document is not a file." }

    const type = mime(resolved)
    const limit = type ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    if (stat.size > limit) return { error: "Document is too large to preview." }

    const relative = path.relative(base, resolved).split(path.sep).join("/")
    if (type) return { file: relative, kind: "image", mime: type, data: fs.readFileSync(resolved).toString("base64") }

    const content = fs.readFileSync(resolved)
    if (content.includes(0)) return { error: "Binary files cannot be previewed." }
    return { file: relative, kind: "text", content: content.toString("utf8") }
  } catch (error) {
    console.error("[Kilo New] AgentManagerProvider: Cannot read document:", error)
    return { error: "Document could not be read." }
  }
}
