/**
 * proxy.ts — HTTP proxy header utilities
 * Zero deps.
 *
 * cleanHeaders(request) → Headers (sanitized)
 */
const HOP = new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","proxy-connection","te","trailer","transfer-encoding","upgrade","host"])

function sanitize(h: Headers) {
  for (const k of HOP) h.delete(k)
  h.delete("accept-encoding")
}

export function cleanHeaders(input: Request | Headers | Record<string, string>, extra?: Record<string, string>): Headers {
  const raw = input instanceof Request ? input.headers : input instanceof Headers ? input : Object.entries(input)
  const out = raw instanceof Headers ? new Headers(raw) : new Headers(raw as [string, string][])
  sanitize(out)
  if (extra) for (const [k, v] of Object.entries(extra)) out.set(k, v)
  return out
}

export function wsProtocols(input: Request | Record<string, string | undefined>): string[] {
  const v = input instanceof Request ? input.headers.get("sec-websocket-protocol") : input["sec-websocket-protocol"]
  return v ? v.split(",").map(s => s.trim()).filter(Boolean) : []
}

export function wsTarget(url: string | URL): string {
  const u = new URL(url)
  if (u.protocol === "http:") u.protocol = "ws:"
  if (u.protocol === "https:") u.protocol = "wss:"
  return u.toString()
}
