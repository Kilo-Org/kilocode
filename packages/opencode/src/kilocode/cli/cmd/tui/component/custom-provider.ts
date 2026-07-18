/**
 * Pure logic for the TUI custom OpenAI-compatible provider wizard.
 *
 * Ported from the VS Code extension's `packages/kilo-vscode/src/shared/custom-provider.ts`
 * and `packages/kilo-vscode/src/shared/fetch-models.ts` so the TUI produces
 * the exact same config shape and deletion-sentinel patches.
 *
 * No JSX / no Solid — unit-testable in isolation.
 */

export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/
export const CUSTOM_PROVIDER_NPM = "@ai-sdk/openai-compatible"

const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/
const HTTP_URL_PATTERN = /^https?:\/\//

export type CustomProviderSecret =
  | { kind: "env"; name: string }
  | { kind: "key"; key: string }
  | { kind: "preserve" }

export type CustomProviderModel = { id: string; name: string }

export type SanitizedCustomProvider = {
  npm: string
  name: string
  env?: string[]
  options: { baseURL: string }
  models: Record<string, { name: string }>
}

export function normalizeProviderID(value: string): string | undefined {
  const trimmed = value.trim().replace(/^@ai-sdk\//, "")
  if (!PROVIDER_ID_PATTERN.test(trimmed)) return undefined
  return trimmed
}

export function validateProviderID(value: string): string | undefined {
  return normalizeProviderID(value)
}

export function validateBaseURL(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return "Base URL is required"
  if (!HTTP_URL_PATTERN.test(trimmed)) return "Base URL must start with http:// or https://"
  try {
    new URL(trimmed)
  } catch {
    return "Base URL is not a valid URL"
  }
  return undefined
}

export function parseSecret(raw: string): CustomProviderSecret | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: "preserve" }
  const match = trimmed.match(/^\{env:([^}]+)\}$/)
  if (!match) return { kind: "key", key: trimmed }
  const name = (match[1] ?? "").trim()
  if (!ENV_NAME_PATTERN.test(name)) return { error: "Environment variable names must be A-Z, 0-9, and underscores (start with letter or underscore)" }
  return { kind: "env", name }
}

export function isCustomProvider(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  const npm = (config as { npm?: unknown }).npm
  return typeof npm === "string"
}

export function buildSanitized(input: {
  id: string
  name: string
  baseURL: string
  secret: CustomProviderSecret
  models: CustomProviderModel[]
}): SanitizedCustomProvider | { error: string } {
  if (!PROVIDER_ID_PATTERN.test(input.id)) return { error: "Invalid provider ID" }
  const name = input.name.trim()
  if (!name) return { error: "Display name is required" }
  const baseURLErr = validateBaseURL(input.baseURL)
  if (baseURLErr) return { error: baseURLErr }
  const models: Record<string, { name: string }> = {}
  for (const m of input.models) {
    const id = m.id.trim()
    if (!id) return { error: "Model ID is required" }
    if (id in models) return { error: `Duplicate model ID: ${id}` }
    const mname = (m.name || id).trim()
    if (!mname) return { error: `Model name is required for ${id}` }
    models[id] = { name: mname }
  }
  if (Object.keys(models).length === 0) return { error: "At least one model is required" }
  const sanitized: SanitizedCustomProvider = {
    npm: CUSTOM_PROVIDER_NPM,
    name,
    options: { baseURL: input.baseURL.trim() },
    models,
  }
  if (input.secret.kind === "env") sanitized.env = [input.secret.name]
  return sanitized
}

/**
 * Build a provider patch that includes null sentinels for model properties
 * that existed in the previous config but are absent from the new one.
 * The CLI `config.update` endpoint deep-merges the payload with the existing
 * config; without explicit nulls, removed entries would persist on disk.
 *
 * Port of `withCustomProviderDeletions`.
 */
export type ProviderPatch = Omit<SanitizedCustomProvider, "models"> & {
  models: Record<string, { name: string } | null>
}

export function buildPatchWithDeletions(existing: unknown, next: SanitizedCustomProvider): ProviderPatch {
  const patched: Record<string, { name: string } | null> = { ...next.models }
  const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
  if (rec(existing) && rec(existing.models)) {
    for (const id of Object.keys(existing.models)) {
      if (!(id in patched)) patched[id] = null
    }
  }
  return { ...next, models: patched }
}

export type FetchModelsResult =
  | { ok: true; models: CustomProviderModel[] }
  | { ok: false; error: string; status?: number }

export async function fetchModels(baseURL: string, key?: string): Promise<FetchModelsResult> {
  const url = baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (key) headers["Authorization"] = `Bearer ${key}`
  let resp: Response
  try {
    resp = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!resp.ok) {
    let text = ""
    try {
      text = (await resp.text()).slice(0, 200)
    } catch {}
    return { ok: false, error: `HTTP ${resp.status}${text ? `: ${text}` : ""}`, status: resp.status }
  }
  let body: unknown
  try {
    body = await resp.json()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" }
  }
  const items = (body as { data?: unknown })?.data
  if (!Array.isArray(items)) return { ok: true, models: [] }
  const seen = new Set<string>()
  const models: CustomProviderModel[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const id = typeof (item as { id?: unknown }).id === "string" ? ((item as { id: string }).id).trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof (item as { name?: unknown }).name === "string" ? ((item as { name: string }).name).trim() : ""
    models.push({ id, name: name || id })
  }
  models.sort((a, b) => a.id.localeCompare(b.id))
  return { ok: true, models }
}