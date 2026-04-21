import { TeamManifestFetchFailed } from "./errors"

export interface FetchOptions {
  timeoutMs?: number
  userAgent?: string
}

export async function fetchManifest<T>(url: string, options?: FetchOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30000
  const userAgent = options?.userAgent ?? "kilo-registry-client/1.0"

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": userAgent },
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new TeamManifestFetchFailed({ url, message: "Request timed out" })
      }
      throw new TeamManifestFetchFailed({ url, message: err instanceof Error ? err.message : String(err) })
    }

    if (!response.ok) {
      throw new TeamManifestFetchFailed({ url, statusCode: response.status })
    }

    const text = await response.text()
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}
