/**
 * Convert a dropped file URI or path into an @-mention path relative to the workspace.
 * Strips file:// and vscode-remote:// protocols, decodes URI components,
 * and produces @/relative/path when the file is inside the workspace.
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
    let relative = normalized.substring(root.length)
    if (!relative.startsWith("/")) relative = "/" + relative
    return "@" + relative.replace(/ /g, "\\ ")
  }

  return cleaned
}

/**
 * Extract file mention paths from a drop's DataTransfer.
 * Returns null if the drop contains no text/URI data (i.e. it's a pure file drop).
 */
export function extractDropPaths(dt: DataTransfer): string[] | null {
  const text = dt.getData("text") || dt.getData("application/vnd.code.uri-list")
  if (!text) return null
  return text.split(/\r?\n/).filter((line) => line.trim() !== "")
}
