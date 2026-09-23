import { Duration, Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const ANYSEARCH_URL = "https://api.anysearch.com/v1/search"
export const MAX_ANYSEARCH_RESULTS = 10

const NO_RESULTS = "No search results found. Please try a different query."
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Envelope = Schema.Struct({
  code: Schema.Number,
  request_id: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
})
const Results = Schema.Struct({ results: Schema.Array(Schema.Unknown) })

export type AnySearchParams = {
  query: string
  numResults?: number
  livecrawl?: string
  type?: string
  contextMaxCharacters?: number
}

export const callAnySearch = Effect.fn("WebSearchAnySearch.call")(function* (
  http: HttpClient.HttpClient,
  params: AnySearchParams,
  key?: string,
) {
  if (params.livecrawl != null || params.type != null || params.contextMaxCharacters != null) {
    return yield* Effect.die(new Error("AnySearch does not support livecrawl, type, or contextMaxCharacters"))
  }

  const count = params.numResults ?? 8
  const max = Number.isFinite(count) ? Math.max(1, Math.min(Math.trunc(count), MAX_ANYSEARCH_RESULTS)) : 8
  const token = key?.trim()
  const request = yield* HttpClientRequest.post(ANYSEARCH_URL).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.setHeaders(token ? { Authorization: `Bearer ${token}` } : {}),
    HttpClientRequest.bodyJson({ query: params.query, max_results: max }),
  )
  const response = yield* http.execute(request).pipe(
    Effect.catch(() => Effect.die(new Error("AnySearch request could not be sent"))),
    Effect.catchDefect(() => Effect.die(new Error("AnySearch request could not be sent"))),
    Effect.timeoutOrElse({
      duration: Duration.seconds(25),
      orElse: () => Effect.die(new Error("AnySearch request timed out")),
    }),
  )

  const status = response.status
  if (status < 200 || status >= 300) {
    const hint =
      status === 401 || status === 403
        ? "access denied; check ANYSEARCH_API_KEY or anonymous access"
        : status === 402
          ? "payment or quota required"
          : status === 429
            ? "rate limited; retry later"
            : status >= 500
              ? "service unavailable; retry later"
              : "request rejected"
    return yield* Effect.die(new Error(`AnySearch ${hint} (HTTP ${status})`))
  }

  const body = yield* response.json.pipe(
    Effect.catch(() => Effect.die(new Error("AnySearch returned invalid JSON"))),
    Effect.catchDefect(() => Effect.die(new Error("AnySearch returned invalid JSON"))),
  )
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(Envelope)(body))
  if (!parsed || !Number.isInteger(parsed.code)) {
    return yield* Effect.die(new Error("AnySearch returned an invalid response"))
  }
  const id = parsed.request_id && UUID.test(parsed.request_id) ? parsed.request_id : undefined
  if (parsed.code !== 0) {
    const ref = id ? `, request_id: ${id}` : ""
    return yield* Effect.die(new Error(`AnySearch request failed (code ${parsed.code}${ref})`))
  }

  const data = Option.getOrUndefined(Schema.decodeUnknownOption(Results)(parsed.data))
  if (!data) {
    const ref = id ? ` (request_id: ${id})` : ""
    return yield* Effect.die(new Error(`AnySearch returned an invalid response${ref}`))
  }

  const results = data.results.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const url = "url" in item && typeof item.url === "string" ? item.url.trim() : ""
    if (!url) return []
    const title = "title" in item && typeof item.title === "string" ? item.title.trim() : ""
    const snippet = "snippet" in item && typeof item.snippet === "string" ? item.snippet.trim() : ""
    const content = "content" in item && typeof item.content === "string" ? item.content.trim() : ""
    return [{ url, title, snippet, content }]
  })
  if (results.length === 0) return NO_RESULTS

  const text = results
    .map((item, index) => {
      const head = `[${index + 1}] ${item.title || item.url}\n${item.url}`
      const snippet = item.snippet ? `\nSnippet: ${item.snippet}` : ""
      const content = item.content && item.content !== item.snippet ? `\nContent: ${item.content}` : ""
      return `${head}${snippet}${content}`
    })
    .join("\n\n")
  const output = `${text}${id ? `\n\nRequest ID: ${id}` : ""}`
  return token ? output.replaceAll(token, "[redacted]") : output
})
