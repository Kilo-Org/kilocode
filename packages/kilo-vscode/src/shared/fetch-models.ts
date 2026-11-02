// Lists the models of an OpenAI-compatible server (`GET {baseURL}/models`) for the custom provider dialog. It runs in
// the extension host, so a stored key never reaches the webview. Kept free of `vscode` imports so it is unit-testable.

export type FetchedModel = { id: string; name: string }

export const FETCH_MODELS_TIMEOUT = 15_000

export class FetchModelsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "FetchModelsError"
  }

  /** The server refused the key: the dialog shows the API-key hint instead of the raw reply. */
  get auth() {
    return this.status === 401 || this.status === 403
  }
}

/**
 * `{baseURL}/models`, with surrounding spaces and trailing slashes of the path removed. The path grows after the base
 * URL path, so a query string (`?api-version=x`) stays a query, and a fragment is dropped.
 */
export function modelsURL(baseURL: string) {
  const url = new URL(baseURL.trim())
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`
  url.hash = ""
  return url.toString()
}

/** True when two base URLs differ only by surrounding spaces or trailing slashes. */
export function sameBaseURL(a: string, b: string) {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "")
  return normalize(a) === normalize(b)
}

export async function fetchOpenAIModels(input: {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  timeout?: number
}): Promise<FetchedModel[]> {
  const timeout = input.timeout ?? FETCH_MODELS_TIMEOUT
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    // The key wins over a custom Authorization header in any letter case, so the request never carries two.
    if (input.apiKey && key.toLowerCase() === "authorization") continue
    headers[key] = value
  }
  if (input.apiKey) headers["Authorization"] = `Bearer ${input.apiKey}`

  const target = (() => {
    try {
      return modelsURL(input.baseURL)
    } catch {
      throw new FetchModelsError("Invalid base URL")
    }
  })()
  const response = await fetch(target, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeout),
  }).catch((error: unknown) => {
    throw fetchError(error, timeout)
  })

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim().slice(0, 200)
    throw new FetchModelsError(`HTTP ${response.status}${text ? `: ${text}` : ""}`, response.status)
  }

  const body: unknown = await response.json().catch(() => {
    throw new FetchModelsError("The server did not return JSON")
  })
  return parseModels(body)
}

/** Reads `{ data: [{ id, name? }] }`: drops entries without an id, removes duplicates and sorts by id. */
export function parseModels(body: unknown): FetchedModel[] {
  const items = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  return items
    .flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return []
      const raw = item as { id?: unknown; name?: unknown }
      const id = typeof raw.id === "string" ? raw.id.trim() : ""
      if (!id || seen.has(id)) return []
      seen.add(id)
      const name = typeof raw.name === "string" ? raw.name.trim() : ""
      return [{ id, name: name || id }]
    })
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

/** The error a failed request reports: a readable timeout, and the connection cause when Node hides it. */
export function fetchError(error: unknown, timeout: number) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return new FetchModelsError(`The server did not answer within ${timeout / 1000} seconds`)
  // Node's fetch reports "fetch failed" and keeps the reason (for example ECONNREFUSED) in `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
  const message = error instanceof Error ? error.message : String(error)
  return new FetchModelsError(cause ? `${message}: ${cause}` : message)
}
