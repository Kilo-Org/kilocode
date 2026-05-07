import type { Config } from "../../types/messages"
import { deepMerge } from "../../utils/config-utils"

/** Maximum import file size in bytes (1 MB). */
export const MAX_IMPORT_SIZE = 1_048_576

/** Current export format version. */
export const META_VERSION = 1

/** Top-level keys recognised as valid Config fields. */
export const KNOWN_KEYS: ReadonlyArray<string> = [
  "permission",
  "model",
  "small_model",
  "default_agent",
  "agent",
  "provider",
  "disabled_providers",
  "enabled_providers",
  "mcp",
  "command",
  "instructions",
  "skills",
  "snapshot",
  "remote_control",
  "share",
  "username",
  "watcher",
  "formatter",
  "lsp",
  "compaction",
  "commit_message",
  "tools",
  "layout",
  "auto_collapse_reasoning",
  "terminal_command_display",
  "indexing",
  "experimental",
]

export type ImportError = "invalidJson" | "invalidConfig" | "tooLarge"
export type ImportWarning = "newerVersion"

export type ImportResult = { ok: true; config: Config; warning?: ImportWarning } | { ok: false; error: ImportError }

interface ExportMeta {
  version: number
  exportedAt: string
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Build a JSON-serialisable export payload from the current config.
 * All fields are included as-is so the export is a complete snapshot
 * that can be imported on another instance without re-entering secrets.
 */
export function buildExport(cfg: Config): Record<string, unknown> {
  const meta: ExportMeta = {
    version: META_VERSION,
    exportedAt: new Date().toISOString(),
  }

  const out: Record<string, unknown> = { _meta: meta }

  for (const [key, value] of Object.entries(cfg)) {
    if (value === undefined || value === null) continue
    out[key] = value
  }

  return out
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string into a validated Config.
 * Unknown keys and `_meta` are stripped. Returns an error tag on failure
 * or a warning when the file was exported from a newer version.
 */
export function parseImport(json: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: "invalidJson" }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "invalidJson" }
  }

  const obj = data as Record<string, unknown>

  // Check for newer version warning
  let warning: ImportWarning | undefined
  const meta = obj._meta
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    const version = (meta as Record<string, unknown>).version
    if (typeof version === "number" && version > META_VERSION) {
      warning = "newerVersion"
    }
  }

  // Keep only known config keys
  const config: Record<string, unknown> = {}
  for (const key of KNOWN_KEYS) {
    if (key in obj && obj[key] !== undefined) {
      config[key] = obj[key]
    }
  }

  // Must have at least one known key
  if (Object.keys(config).length === 0) {
    return { ok: false, error: "invalidConfig" }
  }

  return warning ? { ok: true, config: config as Config, warning } : { ok: true, config: config as Config }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Deep-merge imported config on top of existing config.
 * Imported values take precedence; existing values not in import are preserved.
 */
export function mergeConfig(existing: Config, imported: Config): Config {
  return deepMerge(existing, imported)
}
