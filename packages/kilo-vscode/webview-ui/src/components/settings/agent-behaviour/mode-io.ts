// Import and export for the Agents subtab, in the v2 `agents.<id>` shape. `parseImport` validates an uploaded JSON
// file and returns a config the tab writes at `agents.<id>`; `buildExport` builds the JSON of an edited mode.
import type { PermissionEffect, PermissionRule } from "@opencode/client"

/** Maximum import file size in bytes (1 MB). */
export const MAX_IMPORT_SIZE = 1_048_576

const NAME_RE = /^[a-z][a-z0-9-]*$/
const MODES = ["subagent", "primary", "all"] as const
const EFFECTS = new Set<string>(["allow", "ask", "deny"])

export type ImportError = "invalidJson" | "invalidName" | "nameTaken" | "tooLarge"

export type ImportResult =
  | { ok: true; name: string; config: Record<string, unknown> }
  | { ok: false; error: ImportError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePermissions(raw: unknown): PermissionRule[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const rules = raw.flatMap((item): PermissionRule[] => {
    if (!isRecord(item)) return []
    if (typeof item.action !== "string" || typeof item.resource !== "string") return []
    if (typeof item.effect !== "string" || !EFFECTS.has(item.effect)) return []
    return [{ action: item.action, resource: item.resource, effect: item.effect as PermissionEffect }]
  })
  return rules.length > 0 ? rules : undefined
}

function parseRequestBody(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined
  const body: Record<string, unknown> = {}
  if (typeof raw.temperature === "number") body.temperature = raw.temperature
  if (typeof raw.top_p === "number") body.top_p = raw.top_p
  return Object.keys(body).length > 0 ? body : undefined
}

/**
 * Parse a raw JSON string into a validated agent name and its v2 config.
 * Returns an error tag (the i18n key suffix) on failure.
 */
export function parseImport(json: string, taken: string[]): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: "invalidJson" }
  }
  if (!isRecord(data)) return { ok: false, error: "invalidJson" }

  const name = typeof data.name === "string" ? data.name.trim() : ""
  if (!name || !NAME_RE.test(name)) return { ok: false, error: "invalidName" }
  if (taken.includes(name)) return { ok: false, error: "nameTaken" }

  const config: Record<string, unknown> = { mode: MODES.find((mode) => mode === data.mode) ?? "primary" }
  if (typeof data.description === "string") config.description = data.description
  if (typeof data.system === "string") config.system = data.system
  if (typeof data.model === "string") config.model = data.model
  else if (isRecord(data.model)) config.model = data.model
  if (typeof data.hidden === "boolean") config.hidden = data.hidden
  if (typeof data.disabled === "boolean") config.disabled = data.disabled
  if (typeof data.steps === "number") config.steps = data.steps
  const permissions = parsePermissions(data.permissions)
  if (permissions) config.permissions = permissions
  if (isRecord(data.request)) {
    const body = parseRequestBody(data.request.body)
    if (body) config.request = { body }
  }

  return { ok: true, name, config }
}

/** Build the JSON-serialisable export payload for an agent. */
export function buildExport(name: string, config: Record<string, unknown>): Record<string, unknown> {
  return { name, ...config }
}
