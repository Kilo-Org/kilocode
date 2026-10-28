/** Maximum import file size in bytes (1 MB). */
export const MAX_IMPORT_SIZE = 1_048_576

/** Current export format version. */
export const META_VERSION = 1

/** Top-level config keys a v2 settings file may carry. */
export const KNOWN_KEYS: ReadonlyArray<string> = [
  "shell",
  "model",
  "default_agent",
  "update",
  "share",
  "enterprise",
  "username",
  "permissions",
  "policies",
  "agents",
  "snapshots",
  "watcher",
  "formatter",
  "lsp",
  "media",
  "tool_output",
  "mcp",
  "compaction",
  "skills",
  "commands",
  "instructions",
  "references",
  "websearch",
  "plugins",
  "worktree",
  "warming",
  "providers",
  "experimental",
]

export type ImportError = "invalidJson" | "invalidConfig" | "tooLarge"
export type ImportWarning = "newerVersion"

export type ImportResult =
  | { ok: true; config: Record<string, unknown>; warning?: ImportWarning }
  | { ok: false; error: ImportError }

interface ExportMeta {
  version: number
  exportedAt: string
}

/** Build a JSON-serialisable export payload from a parsed config document. */
export function buildExport(cfg: Record<string, unknown>): Record<string, unknown> {
  const meta: ExportMeta = { version: META_VERSION, exportedAt: new Date().toISOString() }
  const out: Record<string, unknown> = { _meta: meta }
  for (const [key, value] of Object.entries(cfg)) {
    if (key === "$schema" || value === undefined || value === null) continue
    out[key] = value
  }
  return out
}

/**
 * Parse a raw JSON string into a config object with only the known top-level keys. Unknown keys and `_meta` are
 * stripped. Returns an error tag on failure, or a warning when the file was exported from a newer version.
 */
export function parseImport(json: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: "invalidJson" }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, error: "invalidJson" }
  const obj = data as Record<string, unknown>

  let warning: ImportWarning | undefined
  const meta = obj._meta
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    const version = (meta as Record<string, unknown>).version
    if (typeof version === "number" && version > META_VERSION) warning = "newerVersion"
  }

  const config: Record<string, unknown> = {}
  for (const key of KNOWN_KEYS) {
    if (key in obj && obj[key] !== undefined) config[key] = obj[key]
  }
  if (Object.keys(config).length === 0) return { ok: false, error: "invalidConfig" }

  return warning ? { ok: true, config, warning } : { ok: true, config }
}
