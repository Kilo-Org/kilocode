// @ai-sdk/togetherai builds its chat model without `includeUsage`, so streaming
// requests omit `stream_options.include_usage` and Together never sends the final
// usage chunk. Sessions then record zero tokens and zero cost. This wraps the
// provider fetch to add the option to streaming chat completion requests.

import type { TogetherAIProviderSettings } from "@ai-sdk/togetherai"

type Fetch = (...args: Parameters<typeof globalThis.fetch>) => Promise<Response>

export function withStreamUsage(base?: Fetch): typeof globalThis.fetch {
  const fetchFn: Fetch = base ?? ((input, init) => fetch(input, init))
  const wrapped: Fetch = async (input, init) => {
    const body = init?.body
    if (typeof body !== "string") return fetchFn(input, init)
    const parsed = (() => {
      try {
        return JSON.parse(body) as unknown
      } catch {
        return undefined
      }
    })()
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fetchFn(input, init)
    const json = parsed as Record<string, unknown>
    if (json["stream"] !== true) return fetchFn(input, init)
    const existing = json["stream_options"]
    const opts = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {}
    if (opts["include_usage"] === false) return fetchFn(input, init)
    json["stream_options"] = { ...opts, include_usage: true }
    return fetchFn(input, { ...init, body: JSON.stringify(json) })
  }
  return Object.assign(wrapped, { preconnect: globalThis.fetch.preconnect })
}

export async function loadTogetherAI() {
  const mod = await import("@ai-sdk/togetherai")
  return (options: TogetherAIProviderSettings) =>
    mod.createTogetherAI({ ...options, fetch: withStreamUsage(options.fetch) })
}
