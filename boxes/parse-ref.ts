const UNIX_RE =
  /^((?:\/|\.\.?\/)?(?:[a-zA-Z0-9_@-][a-zA-Z0-9_@./-]*\/)*[a-zA-Z0-9_@.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?$/
const WIN_RE =
  /^((?:[a-zA-Z]:[/\\]|\\\\)(?:[^\\/]+[/\\])*[^\\/]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?$/

export function parseRef(
  text: string,
): { path: string; line?: number; col?: number } | undefined {
  if (text.includes("://") || text.includes(" ")) return undefined
  const m = UNIX_RE.exec(text) ?? WIN_RE.exec(text)
  if (!m) return undefined
  return {
    path: m[1],
    line: m[2] ? parseInt(m[2], 10) : undefined,
    col: m[3] ? parseInt(m[3], 10) : undefined,
  }
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function hrefToPath(href: string): string | undefined {
  if (!href) return undefined
  if (href.startsWith("file://")) {
    try {
      const u = new URL(href)
      const d = decodeURIComponent(u.pathname)
      if (!d) return undefined
      const c1 = d.charCodeAt(1)
      const drive =
        d.length >= 4 &&
        d.charCodeAt(0) === 47 &&
        d.charCodeAt(2) === 58 &&
        ((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122))
      return drive ? d.slice(1) : d
    } catch {
      // malformed file:// URL — not a valid file reference
      return undefined
    }
  }
  if (href.includes("://") || SCHEME.test(href)) return undefined
  if (href.startsWith("#")) return undefined
  const cleaned = href.replace(/[#?].*$/, "")
  if (!cleaned || !cleaned.includes(".")) return undefined
  return cleaned
}
