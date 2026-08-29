function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function endpoint(input: string | URL | Request) {
  const raw = input instanceof Request ? input.url : input.toString()
  const path = (() => {
    try {
      return new URL(raw).pathname
    } catch {
      return raw.split(/[?#]/, 1)[0]
    }
  })()
  return path.endsWith("/responses")
}

function strip(input: unknown[]) {
  const kept = input.flatMap((item) => {
    if (!record(item)) return [item]
    if (item.type === "item_reference") return []
    if (!("id" in item)) return [item]

    const next = { ...item }
    delete next.id
    return [next]
  })
  const changed = kept.length !== input.length || kept.some((item, index) => item !== input[index])
  return { kept, changed }
}

/**
 * Rewrites an outgoing gateway request body: strips Responses item ids when
 * storage is disabled, and merges `routing` (the model's configured OpenRouter
 * provider preferences) plus the data-collection setting into the top-level
 * `provider` object. Doing this at the fetch layer covers every transport —
 * the native OpenAI/Anthropic SDKs drop unknown provider options, so routing
 * would otherwise only reach the body through the OpenRouter SDK.
 */
export function transformRequestBody(
  input: string | URL | Request,
  body: BodyInit | null | undefined,
  value?: "allow" | "deny",
  routing?: Record<string, unknown>,
) {
  const responses = endpoint(input)
  const preferences = routing && Object.keys(routing).length > 0 ? routing : undefined
  if (!responses && !value && !preferences) return body
  if (typeof body !== "string") return body

  const data = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return undefined
    }
  })()
  if (!record(data)) return body

  const result = responses && data.store !== true && Array.isArray(data.input) ? strip(data.input) : undefined
  if (!result?.changed && !value && !preferences) return body

  // Preferences already in the body come from the request itself and win over
  // the model-level routing; the privacy setting wins over both.
  const provider = record(data.provider) ? data.provider : {}
  return JSON.stringify({
    ...data,
    ...(result?.changed ? { input: result.kept } : {}),
    ...(value || preferences
      ? { provider: { ...preferences, ...provider, ...(value ? { data_collection: value } : {}) } }
      : {}),
  })
}
