/**
 * Strip an optional :line[-endline][:col] suffix from a code span.
 * Returns the candidate file path and optional line/column numbers.
 */
export function extractSuffix(text: string): { candidate: string; line?: number; column?: number } {
  // Try :line:col first, then :line (with optional -endline range)
  const m3 = /^(.+):(\d+)(?:-\d+)?:(\d+)$/.exec(text)
  if (m3) return { candidate: m3[1], line: +m3[2], column: +m3[3] }
  const m2 = /^(.+):(\d+)(?:-\d+)?$/.exec(text)
  if (m2) return { candidate: m2[1], line: +m2[2] }
  return { candidate: text }
}

/**
 * Normalize a candidate path for filesystem validation.
 * Ensures the path has a ./ prefix if it's a bare relative path,
 * so the extension can stat-check it against the workspace root.
 */
export function normalizeCandidatePath(path: string): string {
  if (path.startsWith("./") || path.startsWith("../") || path.startsWith("/")) return path
  // Windows absolute paths (C:\...) — leave as-is
  if (/^[a-zA-Z]:[/\\]/.test(path)) return path
  // Windows UNC paths (\\server\...) — leave as-is
  if (path.startsWith("\\\\")) return path
  // Strip a/b diff prefixes
  const stripped = path.replace(/^[ab]\//, "")
  return `./${stripped}`
}

// Matches a URI scheme but NOT a Windows drive letter (single char followed by colon).
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/

/**
 * Extract a file path (with optional line/column) from a markdown link href,
 * or return undefined when the href is a URL, anchor, scheme, or otherwise
 * not a file reference.
 *
 * Strips `#fragment` and `?query` suffixes, then parses an optional
 * `:line` or `:line:column` suffix from the remaining path.
 */
export function extractFilePathFromHref(href: string): { path: string; line?: number; column?: number } | undefined {
  if (!href) return undefined
  // Handle file:// URLs — extract the path component and decode it
  if (href.startsWith("file://")) {
    try {
      const url = new URL(href)
      const decoded = decodeURIComponent(url.pathname)
      if (!decoded) return undefined
      // On Windows, file:///C:/foo gives pathname=/C:/foo — strip the leading slash
      // so the result is a valid Windows absolute path (C:/foo).
      const c1 = decoded.charCodeAt(1)
      const isWindowsDrive =
        decoded.length >= 4 &&
        decoded.charCodeAt(0) === 47 /* / */ &&
        decoded.charCodeAt(2) === 58 /* : */ &&
        ((c1 >= 65 && c1 <= 90) /* A-Z */ || (c1 >= 97 && c1 <= 122)) /* a-z */
      return { path: isWindowsDrive ? decoded.slice(1) : decoded }
    } catch {
      return undefined
    }
  }
  // Skip actual URLs and non-file schemes (mailto:, tel:, etc.)
  if (href.includes("://") || SCHEME_RE.test(href)) return undefined
  // Skip pure anchors
  if (href.startsWith("#")) return undefined
  // Strip fragment and query before treating as file path
  const cleaned = href.replace(/[#?].*$/, "")
  if (!cleaned) return undefined
  // Strip a/b diff prefixes, parse :line[:col] suffix
  const stripped = cleaned.replace(/^[ab]\//, "")
  const { candidate, line, column } = extractSuffix(stripped)
  return { path: candidate, line, column }
}
