export const INDEXING_PLUGIN_NAMES = ["kilo-indexing", "@kilocode/kilo-indexing"] as const

// RATIONALE: PluginSpec is string | [string, Record] — accept both forms.
type Candidate = string | readonly [string, ...unknown[]]

const names = new Set<string>(INDEXING_PLUGIN_NAMES)
const pathRx = /^[A-Za-z]:[\\/]/

export function normalizePluginName(value: string): string {
  if (!value) return ""
  if (value.startsWith("file://")) {
    return normalizePath(fromFileUrl(value))
  }
  if (isPathSpecifier(value)) {
    return normalizePath(value)
  }
  return normalizePackage(value)
}

function specifier(value: Candidate): string {
  return typeof value === "string" ? value : value[0]
}

export function isIndexingPlugin(value: Candidate): boolean {
  return names.has(normalizePluginName(specifier(value)))
}

export function hasIndexingPlugin(values?: readonly Candidate[]): boolean {
  return values?.some(isIndexingPlugin) ?? false
}

function stripVersion(value: string): string {
  if (!value.startsWith("@")) {
    const at = value.lastIndexOf("@")
    return at > 0 ? value.slice(0, at) : value
  }

  const slash = value.indexOf("/")
  if (slash === -1) return value
  const at = value.indexOf("@", slash)
  return at === -1 ? value : value.slice(0, at)
}

function normalizePackage(value: string): string {
  return stripVersion(value)
}

function isPathSpecifier(value: string): boolean {
  if (value.startsWith("@")) return false
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("\\")) return true
  if (pathRx.test(value)) return true
  if (!value.includes("/") && !value.includes("\\")) return false

  const normalized = value.replaceAll("\\", "/")
  if (normalized.includes("/node_modules/")) return true
  if (normalized.includes("/.opencode/") || normalized.includes("/.kilo/") || normalized.includes("/.kilocode/")) {
    return true
  }

  return /\.[cm]?[jt]s$/.test(normalized)
}

function normalizePath(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean)
  const idx = parts.lastIndexOf("node_modules")

  if (idx >= 0) {
    const head = parts[idx + 1]
    if (head?.startsWith("@")) {
      const tail = parts[idx + 2]
      if (tail) return `${head}/${tail}`
    }
    if (head) return head
  }

  const scoped = parts.findIndex((part, i) => part === "@kilocode" && parts[i + 1] === "kilo-indexing")
  if (scoped >= 0) return "@kilocode/kilo-indexing"

  const workspace = parts.findIndex((part, i) => part === "packages" && parts[i + 1] === "kilo-indexing")
  if (workspace >= 0) return "@kilocode/kilo-indexing"

  return stem(value)
}

function fromFileUrl(value: string): string {
  const url = new URL(value)
  const path = decodeURIComponent(url.pathname)
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1)
  if (url.host) return `//${url.host}${path}`
  return path
}

function stem(value: string): string {
  const part = value.split(/[\\/]+/).filter(Boolean).at(-1) ?? value
  const dot = part.lastIndexOf(".")
  if (dot <= 0) return part
  return part.slice(0, dot)
}
