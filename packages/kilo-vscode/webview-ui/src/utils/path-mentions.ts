/**
 * Convert a dropped file URI or absolute path into a relative workspace path.
 * Strips file:// and vscode-remote:// protocols, decodes URI components,
 * and produces a relative path (e.g. "src/index.ts") when the file is inside
 * the workspace. Returns the cleaned absolute path for files outside the workspace.
 *
 * The returned path does NOT include the "@" prefix — callers add that when
 * inserting into the textarea so the path can also be registered in mentionedPaths.
 */
export function convertToMentionPath(path: string, cwd: string): string {
  let cleaned = path

  if (cleaned.startsWith("file://")) {
    cleaned = cleaned.substring(7)
  } else if (cleaned.startsWith("vscode-remote://")) {
    const rest = cleaned.substring("vscode-remote://".length)
    const idx = rest.indexOf("/")
    cleaned = idx !== -1 ? rest.substring(idx) : ""
  }

  try {
    cleaned = decodeURIComponent(cleaned)
    // Remove leading slash for Windows paths like /d:/...
    if (cleaned.startsWith("/") && cleaned[2] === ":") {
      cleaned = cleaned.substring(1)
    }
  } catch (err) {
    console.error("[Kilo New] Failed to decode dropped URI:", err, cleaned)
  }

  const normalized = cleaned.replace(/\\/g, "/")
  let root = cwd.replace(/\\/g, "/")
  if (root.endsWith("/")) root = root.slice(0, -1)

  if (!root) return cleaned

  if (normalized.toLowerCase().startsWith(root.toLowerCase())) {
    const tail = normalized.substring(root.length)
    // Boundary check: next char must be "/" or end of string to avoid
    // /workspace/app matching /workspace/app2/file.ts
    if (tail === "" || tail.startsWith("/")) {
      const relative = tail.startsWith("/") ? tail.substring(1) : tail
      return relative || cleaned
    }
  }

  return cleaned
}

/** Returns true when the line looks like a file URI or absolute path. */
function isFilePath(line: string): boolean {
  if (line.startsWith("file://") || line.startsWith("vscode-remote://")) return true
  // Unix absolute path
  if (line.startsWith("/")) return true
  // Windows absolute path (e.g. C:\, D:/)
  if (/^[A-Za-z]:[\\/]/.test(line)) return true
  return false
}

/**
 * Custom MIME type used for internal drag-and-drop of relative file paths
 * (e.g. from diff panel file headers). Unlike VS Code's URI list, these
 * are workspace-relative paths that can be used directly as @mentions.
 */
export const KILO_FILE_PATH_MIME = "application/x-kilo-file-path"

/**
 * Extract file paths from a drop's DataTransfer.
 * Checks (in order):
 * 1. Internal relative-path drag (application/x-kilo-file-path)
 * 2. VS Code URI-list (application/vnd.code.uri-list)
 * 3. text/plain — only when every line looks like an absolute file path
 *
 * Returns null if no file paths are found.
 */
export function extractDropPaths(dt: DataTransfer): string[] | null {
  // Internal relative-path drag from diff file headers etc.
  const kilo = dt.getData(KILO_FILE_PATH_MIME)
  if (kilo) {
    const paths = kilo.split(/\r?\n/).filter((line) => line.trim() !== "")
    if (paths.length > 0) return paths
  }

  // VS Code-specific URI list (explorer, editor tabs)
  const uri = dt.getData("application/vnd.code.uri-list")
  if (uri) {
    const paths = uri.split(/\r?\n/).filter((line) => line.trim() !== "")
    if (paths.length > 0) return paths
  }

  // Fall back to text/plain only if every line is a recognizable file path
  const text = dt.getData("text")
  if (text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
    if (lines.length > 0 && lines.every(isFilePath)) return lines
  }

  return null
}
