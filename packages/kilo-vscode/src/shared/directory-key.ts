// Cross-platform directory path key normalization shared by the extension host and the webview. The server's
// LocationServiceMap emits OS-native separators (backslashes on Windows) while Agent Manager stores forward-slash
// lowercased Windows paths from `canonicalizePath`, so strict equality drops located events on Windows.

/**
 * Normalize a directory path for cross-platform key comparison.
 * Converts backslashes to forward slashes, strips trailing slashes (preserving `/` and Windows drive roots `c:/`),
 * and lowercases case-insensitive Windows drive-letter and UNC paths.
 */
export function directoryKey(directory: string): string {
  if (!directory) return ""
  const slashes = directory.replace(/\\/g, "/")
  const trimmed = slashes.replace(/\/+$/, "") || "/"
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed.toLowerCase()}/`
  if (/^[A-Za-z]:\//.test(trimmed) || /^\/\/[^/]/.test(trimmed)) return trimmed.toLowerCase()
  return trimmed
}
