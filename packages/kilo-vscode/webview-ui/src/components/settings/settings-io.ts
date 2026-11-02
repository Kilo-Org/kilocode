/** Maximum import file size in bytes (1 MB). */
export const MAX_IMPORT_SIZE = 1_048_576

/** Current export format version. */
export const META_VERSION = 1

/** Top-level config keys a v2 settings file may carry. Export and import use this one set, so a transfer is lossless. */
export const KNOWN_KEYS: ReadonlyArray<string> = [
  "shell",
  "model",
  "default_agent",
  "update",
  "share",
  "enterprise",
  "username",
  "permissions",
  "permission",
  "policies",
  "agents",
  "agent",
  "mode",
  "small_model",
  "snapshots",
  "snapshot",
  "autoupdate",
  "autoshare",
  "watcher",
  "formatter",
  "lsp",
  "media",
  "attachment",
  "tool_output",
  "tools",
  "mcp",
  "compaction",
  "skills",
  "commands",
  "command",
  "instructions",
  "references",
  "reference",
  "websearch",
  "plugins",
  "plugin",
  "worktree",
  "warming",
  "providers",
  "provider",
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

/** Build a JSON-serialisable export payload from a parsed config document, keeping only importable keys. */
export function buildExport(cfg: Record<string, unknown>): Record<string, unknown> {
  const meta: ExportMeta = { version: META_VERSION, exportedAt: new Date().toISOString() }
  const out: Record<string, unknown> = { _meta: meta }
  for (const key of KNOWN_KEYS) {
    const value = cfg[key]
    if (value === undefined || value === null) continue
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
  const hasMeta = typeof meta === "object" && meta !== null && !Array.isArray(meta)
  if (hasMeta) {
    const version = (meta as Record<string, unknown>).version
    if (typeof version === "number" && version > META_VERSION) warning = "newerVersion"
  }

  const config: Record<string, unknown> = {}
  for (const key of KNOWN_KEYS) {
    if (key in obj && obj[key] !== undefined) config[key] = obj[key]
  }
  // A `_meta`-only file is a valid export of an empty config; anything else with no known key is invalid.
  if (Object.keys(config).length === 0 && !hasMeta) return { ok: false, error: "invalidConfig" }

  return warning ? { ok: true, config, warning } : { ok: true, config }
}
