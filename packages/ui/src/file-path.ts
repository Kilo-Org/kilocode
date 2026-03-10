// kilocode_change - new file

// Matches text that looks like a file path:
// - Unix: /foo/bar.ts, ./foo.ts, ../foo.ts, foo.ts
// - Windows drive: C:\foo\bar.ts, C:/foo/bar.ts
// - Windows UNC: \\server\share\file.ts
// Supports optional :line or :line:col suffix.
const FILE_PATH_UNIX_RE =
  /^((?:\/|\.\.?\/)?(?:[a-zA-Z0-9_@-][a-zA-Z0-9_@./-]*\/)*[a-zA-Z0-9_@.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?$/
const FILE_PATH_WIN_RE = /^((?:[a-zA-Z]:[/\\]|\\\\)(?:[^\\/]+[/\\])*[^\\/]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?$/

/**
 * Parse an inline code span into a file path with optional line/column.
 * Returns undefined when the text does not look like a file reference.
 *
 * Handles Unix paths (`/foo/bar.ts`, `./foo.ts`, `foo.ts`),
 * Windows drive paths (`C:\foo\bar.ts`), and UNC paths (`\\server\share\file.ts`).
 */
export function parseFilePath(text: string): { path: string; line?: number; column?: number } | undefined {
  if (text.includes("://")) return undefined
  if (text.includes(" ")) return undefined
  const match = FILE_PATH_UNIX_RE.exec(text) ?? FILE_PATH_WIN_RE.exec(text)
  if (!match) return undefined
  return {
    path: match[1],
    line: match[2] ? parseInt(match[2], 10) : undefined,
    column: match[3] ? parseInt(match[3], 10) : undefined,
  }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * Extract a file path from a markdown link href, or return undefined
 * when the href is a URL, anchor, scheme, or otherwise not a file reference.
 *
 * Strips `#fragment` and `?query` suffixes before returning the path.
 */
export function extractFilePathFromHref(href: string): string | undefined {
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
      return isWindowsDrive ? decoded.slice(1) : decoded
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
  // Must look like a file path (has a dot for extension)
  if (!cleaned.includes(".")) return undefined
  return cleaned
}
