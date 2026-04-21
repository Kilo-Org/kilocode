import { TeamManifestFetchFailed } from "./errors"

/** 5 MB hard cap — manifests are JSON blobs, anything larger is anomalous */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/**
 * Blocks non-HTTPS schemes and RFC-1918 / loopback destinations to prevent SSRF.
 * Applied against `parsed.hostname` (lowercase, no port).
 */
const BLOCKED_HOSTNAME = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|::1|0\.0\.0\.0)$/i

function validateManifestUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TeamManifestFetchFailed({ url, message: "Invalid URL" })
  }
  if (parsed.protocol !== "https:") {
    throw new TeamManifestFetchFailed({ url, message: "Only HTTPS URLs are permitted for registry manifests" })
  }
  if (BLOCKED_HOSTNAME.test(parsed.hostname)) {
    throw new TeamManifestFetchFailed({ url, message: "Registry URL targets a private or loopback address" })
  }
}

export interface FetchOptions {
  timeoutMs?: number
  userAgent?: string
}

export async function fetchManifest<T>(url: string, options?: FetchOptions): Promise<T> {
  validateManifestUrl(url)

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

    // Guard against oversized responses before buffering the body
    const contentLength = response.headers.get("content-length")
    if (contentLength !== null && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new TeamManifestFetchFailed({ url, message: `Response too large (Content-Length: ${contentLength} bytes, max ${MAX_RESPONSE_BYTES})` })
    }

    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new TeamManifestFetchFailed({ url, message: `Response body exceeds ${MAX_RESPONSE_BYTES} byte limit` })
    }
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}
