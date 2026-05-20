// kilocode_change start
import { Effect, Schema } from "effect"
import { InstallationVersion } from "@opencode-ai/core/installation/version" // kilocode_change
import * as Tool from "./tool"
import DESCRIPTION from "./websearch.txt"

export const PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search"
export const PERPLEXITY_INTEGRATION_HEADER = "X-Pplx-Integration"
export const PERPLEXITY_INTEGRATION_SLUG = "kilo-code"
export const perplexityIntegrationValue = () => `${PERPLEXITY_INTEGRATION_SLUG}/${InstallationVersion}`

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }), // kilocode_change
  max_results: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(5))).annotate({
    description: "Maximum number of search results to return (default: 5)",
  }),
  country: Schema.optional(Schema.String).annotate({
    description: "Optional ISO 3166-1 alpha-2 country code to localize results",
  }),
})

const Page = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  snippet: Schema.String,
  date: Schema.optional(Schema.NullOr(Schema.String)),
  last_updated: Schema.optional(Schema.NullOr(Schema.String)),
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(Page),
})

type Params = Schema.Schema.Type<typeof Parameters>
type SearchResponse = Schema.Schema.Type<typeof SearchResponse>

const decode = Schema.decodeUnknownEffect(SearchResponse)

function key() {
  return process.env["PERPLEXITY_API_KEY"] || process.env["PPLX_API_KEY"]
}

function body(params: Params) {
  return {
    query: params.query,
    max_results: params.max_results,
    ...(params.country ? { country: params.country } : {}),
  }
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function failure(error: unknown) {
  return `Perplexity Search failed: ${message(error)}`
}

export function formatSearchResults(data: SearchResponse, query: string) {
  if (data.results.length === 0) return `No search results found for "${query}".`

  return data.results
    .map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        `URL: ${item.url}`,
        `Date: ${item.date || item.last_updated || "unknown"}`,
        `Snippet: ${item.snippet}`,
      ].join("\n"),
    )
    .join("\n\n")
}

function search(params: Params, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const token = key()
    if (!token) {
      return "Perplexity Search is unavailable because PERPLEXITY_API_KEY is not set. Set PERPLEXITY_API_KEY or PPLX_API_KEY to enable web search."
    }

    yield* ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        max_results: params.max_results,
        country: params.country,
      },
    })

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(PERPLEXITY_SEARCH_URL, {
          method: "POST",
          signal: ctx.abort,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            [PERPLEXITY_INTEGRATION_HEADER]: perplexityIntegrationValue(),
          },
          body: JSON.stringify(body(params)),
        }),
      catch: (err) => new Error(message(err)),
    })

    if (!response.ok) {
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (err) => new Error(message(err)),
      }).pipe(Effect.catch(() => Effect.succeed("")))
      return `Perplexity Search failed with HTTP ${response.status}${text ? `: ${text}` : ""}`
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (err) => new Error(message(err)),
    })
    const data = yield* decode(json)
    return formatSearchResults(data, params.query)
  }).pipe(Effect.catch((err) => Effect.succeed(failure(err))))
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.succeed({
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: Parameters,
    execute: (params: Params, ctx: Tool.Context) =>
      search(params, ctx).pipe(
        Effect.map((output) => ({
          output,
          title: `Web search: ${params.query}`,
          metadata: {},
        })),
        Effect.orDie,
      ),
  }),
)
// kilocode_change end
