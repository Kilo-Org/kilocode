import net from "net"
import { TeamManifestFetchFailed } from "./errors"

/** 5 MB hard cap — manifests are JSON blobs, anything larger is anomalous */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/**
 * Returns true when the WHATWG-normalised hostname targets a private, loopback,
 * link-local, or otherwise off-limits address.
 *
 * Uses `net.isIPv4` / `net.isIPv6` to correctly classify the hostname after the
 * WHATWG URL parser has normalised it.  For the `https:` scheme (a "special URL"
 * in the WHATWG spec) the parser converts integer-form IPv4 (e.g. 2130706433)
 * to dotted-quad notation before we receive it here, so integer-form bypass
 * attempts are already defused at the URL-parse stage.
 *
 * IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) are blocked wholesale because
 * they transparently proxy any IPv4 address, including private ranges.
 */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()

  // Explicit name check (catches "localhost" regardless of IP resolution)
  if (h === "localhost") return true

  // IPv4 numeric check — covers dotted-quad and (post-normalisation) integer form
  if (net.isIPv4(h)) {
    const octets = h.split(".").map(Number)
    const a = octets[0]
    const b = octets[1]
    return (
      a === 0 ||                              // 0.0.0.0/8
      a === 10 ||                             // 10.0.0.0/8 RFC-1918
      a === 127 ||                            // 127.0.0.0/8 loopback
      (a === 100 && b >= 64 && b <= 127) ||   // 100.64.0.0/10 carrier-grade NAT (RFC 6598)
      (a === 169 && b === 254) ||             // 169.254.0.0/16 link-local / cloud metadata IMDS
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12 RFC-1918
      (a === 192 && b === 168)                // 192.168.0.0/16 RFC-1918
    )
  }

  // IPv6 checks — block loopback, ULA, link-local, and ALL IPv4-mapped addresses
  if (net.isIPv6(h)) {
    return (
      h === "::1" ||              // loopback
      h.startsWith("::ffff:") ||  // IPv4-mapped — bypasses IPv4 range checks entirely
      h.startsWith("fc") ||       // fc00::/7 ULA (private)
      h.startsWith("fd") ||       // fd00::/8 ULA (private)
      h.startsWith("fe80")        // fe80::/10 link-local
    )
  }

  return false
}

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
  if (isBlockedHostname(parsed.hostname)) {
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
