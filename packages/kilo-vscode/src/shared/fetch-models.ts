/**
 * Fetch available models from an OpenAI-compatible or Anthropic /models endpoint.
 * Runs in the extension host — no CLI backend dependency.
 */

type Options = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  npm?: string
}

type ModelEntry = {
  id: string
  name: string
}

type RawModel = {
  id?: string
  name?: string
  display_name?: string
}

const ANTHROPIC_VERSION = "2023-06-01"
const ANTHROPIC_PAGE = 100
const ANTHROPIC_MAX_PAGES = 20

export class FetchModelsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "FetchModelsError"
  }

  get auth() {
    return this.status === 401 || this.status === 403
  }
}

export function collectModels(items: unknown): ModelEntry[] {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const raw = item as RawModel
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = typeof raw.display_name === "string" ? raw.display_name : raw.name
    result.push({ id, name: typeof label === "string" && label.trim() ? label.trim() : id })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

export async function fetchOpenAIModels(opts: Options): Promise<ModelEntry[]> {
  if (opts.npm === "@ai-sdk/anthropic") return fetchAnthropicModels(opts)
  return fetchCompatibleModels(opts)
}

async function fetchCompatibleModels(opts: Options): Promise<ModelEntry[]> {
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`
  }

  const body = await getJson(url, headers)
  return collectModels((body as { data?: unknown }).data)
}

async function fetchAnthropicModels(opts: Options): Promise<ModelEntry[]> {
  const base = opts.baseURL.replace(/\/+$/, "")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey
  }

  const items: unknown[] = []
  let after: string | undefined

  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(ANTHROPIC_PAGE) })
    if (after) params.set("after_id", after)
    const body = (await getJson(`${base}/models?${params}`, headers)) as {
      data?: unknown
      has_more?: boolean
      last_id?: string
    }
    if (Array.isArray(body.data)) items.push(...body.data)
    if (!body.has_more) break
    after = typeof body.last_id === "string" && body.last_id ? body.last_id : undefined
    if (!after) break
  }

  return collectModels(items)
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new FetchModelsError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status)
  }

  return response.json()
}
