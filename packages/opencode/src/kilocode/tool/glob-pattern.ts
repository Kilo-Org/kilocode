import path from "node:path"

/** Shared by the native glob tool and AutoGuard's resource normalization. */
export function split(pattern: string) {
  const normalized = pattern.replaceAll("\\", "/")
  if (!path.isAbsolute(normalized)) return
  const index = normalized.search(/[*?{[]/)
  if (index === -1) return { dir: normalized, pattern: "*" }
  const slice = normalized.slice(0, index)
  const cut = slice.lastIndexOf("/")
  const dir = cut > 0 ? slice.slice(0, cut) : "/"
  const next = normalized.slice(cut + 1)
  return { dir, pattern: next || "*" }
}
