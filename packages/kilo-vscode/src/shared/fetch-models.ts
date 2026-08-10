/**
 * Fetch available models from an OpenAI-compatible or Anthropic /models endpoint.
 * Runs in the extension host — no CLI backend dependency.
 */

export type Options = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
}

export type ModelEntry = {
  id: string
  name: string
}

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

export async function fetchOpenAIModels(opts: Options): Promise<ModelEntry[]> {
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new FetchModelsError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status)
  }

  const body = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
  const items = body?.data
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name: typeof item.name === "string" ? item.name.trim() : id })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

function resolveAnthropicURL(baseURL: string) {
  const base = baseURL.replace(/\/+$/, "")
  let path = base
  if (path.endsWith("/messages")) {
    path = path.slice(0, -9).replace(/\/+$/, "")
  }
  if (path.endsWith("/models")) {
    // already ends with /models
  } else if (path.endsWith("/v1")) {
    path = `${path}/models`
  } else if (path === "https://api.anthropic.com") {
    path = "https://api.anthropic.com/v1/models"
  } else {
    path = `${path}/models`
  }

  const urlObj = new URL(path)
  if (!urlObj.searchParams.has("limit")) {
    urlObj.searchParams.set("limit", "1000")
  }
  return { base, url: urlObj.toString() }
}

function parseAnthropicError(text: string, status: number) {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.error?.message === "string") {
      return parsed.error.message
    }
  } catch {
    // ignore non-json error responses
  }
  return `HTTP ${status}: ${text.slice(0, 200)}`
}

function parseAnthropicItems(items: unknown) {
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const obj = item as { id?: string; name?: string; display_name?: string }
    const id = typeof obj.id === "string" ? obj.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name =
      typeof obj.display_name === "string" && obj.display_name.trim()
        ? obj.display_name.trim()
        : typeof obj.name === "string" && obj.name.trim()
          ? obj.name.trim()
          : id
    result.push({ id, name })
  }
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

/**
 * Fetch available models from an Anthropic /models endpoint.
 * Supports api.anthropic.com as well as Anthropic-compatible proxies and gateways.
 */
export async function fetchAnthropicModels(opts: Options): Promise<ModelEntry[]> {
  const { base, url } = resolveAnthropicURL(opts.baseURL)

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network request failed"
    throw new FetchModelsError(msg)
  }

  if (response.status === 404 && !base.includes("/v1")) {
    const fallbackUrl = new URL(`${base}/v1/models`)
    fallbackUrl.searchParams.set("limit", "1000")
    const fallbackRes = await fetch(fallbackUrl.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (fallbackRes?.ok) {
      response = fallbackRes
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new FetchModelsError(parseAnthropicError(text, response.status), response.status)
  }

  const body = (await response.json()) as {
    data?: unknown
    models?: unknown
  }
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  return parseAnthropicItems(items)
}

export type CustomModelsOptions = Options & {
  npm?: string
}

export async function fetchCustomModels(opts: CustomModelsOptions): Promise<ModelEntry[]> {
  if (opts.npm === "@ai-sdk/anthropic") {
    return fetchAnthropicModels(opts)
  }
  return fetchOpenAIModels(opts)
}
