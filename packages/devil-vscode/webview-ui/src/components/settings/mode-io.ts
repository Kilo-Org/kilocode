import type { AgentConfig, PermissionConfig } from "../../types/messages"

/** Maximum import file size in bytes (1 MB). */
export const MAX_IMPORT_SIZE = 1_048_576

const NAME_RE = /^[a-z][a-z0-9-]*$/
const MODES = ["subagent", "primary", "all"] as const
const LEVELS = new Set(["allow", "ask", "deny"])

export type ImportError = "invalidJson" | "invalidName" | "nameTaken" | "tooLarge"

export type ImportResult = { ok: true; name: string; config: AgentConfig } | { ok: false; error: ImportError }

/** Check if a value is a valid permission level string. */
function isLevel(v: unknown): boolean {
  return typeof v === "string" && LEVELS.has(v)
}

/** Validate and extract a permission map, dropping unknown entries. */
function parsePermission(raw: unknown): PermissionConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  const out: PermissionConfig = {}
  let count = 0
  for (const [key, val] of Object.entries(raw)) {
    if (isLevel(val)) {
      out[key] = val as PermissionConfig[string]
      count++
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      // Nested per-pattern rules like { "*": "ask", "uname": "allow" }
      const nested: Record<string, string | null> = {}
      let valid = 0
      for (const [pat, lev] of Object.entries(val)) {
        if (isLevel(lev)) {
          nested[pat] = lev as string
          valid++
        }
      }
      if (valid > 0) {
        out[key] = nested as PermissionConfig[string]
        count++
      }
    }
  }
  return count > 0 ? out : undefined
}

/**
 * Parse a raw JSON string into a validated agent name + config.
 * Returns an error tag (matching the i18n key suffix) on failure.
 */
export function parseImport(json: string, taken: string[]): ImportResult {
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

  const name = typeof obj.name === "string" ? obj.name.trim() : ""
  if (!name || !NAME_RE.test(name)) {
    return { ok: false, error: "invalidName" }
  }
  if (taken.includes(name)) {
    return { ok: false, error: "nameTaken" }
  }

  const partial: Partial<AgentConfig> = {}
  if (typeof obj.description === "string") partial.description = obj.description
  if (typeof obj.prompt === "string") partial.prompt = obj.prompt
  if (typeof obj.model === "string") partial.model = obj.model
  if (typeof obj.mode === "string" && (MODES as readonly string[]).includes(obj.mode))
    partial.mode = obj.mode as AgentConfig["mode"]
  if (typeof obj.temperature === "number") partial.temperature = obj.temperature
  if (typeof obj.top_p === "number") partial.top_p = obj.top_p
  if (typeof obj.steps === "number") partial.steps = obj.steps
  const perms = parsePermission(obj.permission)
  if (perms) partial.permission = perms

  return {
    ok: true,
    name,
    config: { ...partial, mode: partial.mode ?? "primary" },
  }
}

/**
 * Build the JSON-serialisable export payload for a mode.
 */
export function buildExport(name: string, cfg: AgentConfig): Record<string, unknown> {
  return { name, ...cfg }
}
