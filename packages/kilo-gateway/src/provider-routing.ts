import { HEADER_PROVIDER_ROUTING } from "./api/constants.js"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Request headers carrying the effective OpenRouter provider routing
 * preferences (`order`, `only`, `allow_fallbacks`, ...) for one request.
 *
 * Routing is resolved per request — model options, agent options, variants and
 * plugin overrides all contribute — but only the OpenRouter SDK forwards a
 * `provider` object from provider options into the body; the native OpenAI and
 * Anthropic SDKs drop it. A request header reaches the gateway fetch wrapper
 * on every transport, which merges it into the body and strips the header.
 */
export function providerRoutingHeaders(routing: unknown): Record<string, string> {
  if (!record(routing) || Object.keys(routing).length === 0) return {}
  // Header values are byte strings; slugs are ASCII but hand-written config is not guaranteed to be.
  return { [HEADER_PROVIDER_ROUTING]: encodeURIComponent(JSON.stringify(routing)) }
}

/** Remove the routing header from an outgoing request and return its preferences. */
export function takeProviderRouting(headers: Headers): Record<string, unknown> | undefined {
  const raw = headers.get(HEADER_PROVIDER_ROUTING)
  if (raw === null) return undefined
  headers.delete(HEADER_PROVIDER_ROUTING)
  const parsed = (() => {
    try {
      return JSON.parse(decodeURIComponent(raw)) as unknown
    } catch {
      return undefined
    }
  })()
  return record(parsed) ? parsed : undefined
}
