/**
 * Fetch available models from an OpenAI-compatible or Anthropic /models endpoint.
 * Runs in the extension host — no CLI backend dependency.
 */

const ANTHROPIC_NPM = "@ai-sdk/anthropic"
const ANTHROPIC_VERSION = "2023-06-01"
const PAGE = 1000
const PAGES = 20

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

type Item = { id?: string; name?: string; display_name?: string }
type Body = { data?: Item[]; has_more?: boolean; last_id?: string }

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

function headers(opts: Options, anthropic: boolean) {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) result.Authorization = `Bearer ${opts.apiKey}`
  if (!anthropic) return result
  result["anthropic-version"] = ANTHROPIC_VERSION
  if (opts.apiKey) result["x-api-key"] = opts.apiKey
  return result
}

function collect(items: Item[], seen: Set<string>, result: ModelEntry[]) {
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = typeof item.display_name === "string" ? item.display_name.trim() : ""
    const name = typeof item.name === "string" ? item.name.trim() : ""
    result.push({ id, name: label || name || id })
  }
}

function target(base: string, anthropic: boolean, after?: string) {
  const root = base.replace(/\/+$/, "") + "/models"
  if (!anthropic) return root
  const query = new URLSearchParams({ limit: String(PAGE) })
  if (after) query.set("after_id", after)
  return `${root}?${query}`
}

async function load(opts: Options, anthropic: boolean): Promise<ModelEntry[]> {
  const seen = new Set<string>()
  const result: ModelEntry[] = []
  let after: string | undefined

  for (let page = 0; page < PAGES; page++) {
    const response = await fetch(target(opts.baseURL, anthropic, after), {
      method: "GET",
      headers: headers(opts, anthropic),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new FetchModelsError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status)
    }

    const body = (await response.json()) as Body
    const items = body?.data
    if (!Array.isArray(items)) break
    collect(items, seen, result)
    const next = typeof body.last_id === "string" ? body.last_id.trim() : ""
    if (!body.has_more || !next || next === after) break
    after = next
  }

  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

export async function fetchOpenAIModels(opts: Options): Promise<ModelEntry[]> {
  return load(opts, false)
}

export async function fetchProviderModels(opts: Options): Promise<ModelEntry[]> {
  if (opts.npm !== ANTHROPIC_NPM) return load(opts, false)
  try {
    return await load(opts, true)
  } catch (err) {
    if (err instanceof FetchModelsError && err.auth) throw err
    try {
      return await load(opts, false)
    } catch {
      throw err
    }
  }
}
