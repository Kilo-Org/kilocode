// kilocode_change - new file

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { PERPLEXITY_INTEGRATION_HEADER, perplexityIntegrationValue } from "@/kilocode/provider/provider"

const URL = "https://api.perplexity.ai/search"

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  numResults: Schema.optional(Schema.Number),
  contextMaxCharacters: Schema.optional(Schema.Number),
})

const SearchRequest = Schema.Struct({
  query: Schema.String,
  max_results: Schema.Number,
  max_tokens_per_page: Schema.optional(Schema.Number),
})

const SearchResult = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  snippet: Schema.String,
  date: Schema.optional(Schema.String),
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(SearchResult),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(SearchResponse))

const key = () => process.env.PERPLEXITY_API_KEY ?? process.env.PPLX_API_KEY

const tokens = (chars: number | undefined) => (chars === undefined ? undefined : Math.max(64, Math.floor(chars / 4)))

const body = (input: Schema.Schema.Type<typeof SearchArgs>) => {
  const max = tokens(input.contextMaxCharacters)
  return {
    query: input.query,
    max_results: input.numResults ?? 8,
    ...(max === undefined ? {} : { max_tokens_per_page: max }),
  }
}

const format = (results: ReadonlyArray<Schema.Schema.Type<typeof SearchResult>>) => {
  if (results.length === 0) return undefined
  return results
    .map((item, idx) =>
      [`Result ${idx + 1}: ${item.title}`, `URL: ${item.url}`, `Snippet: ${item.snippet}`].join("\n"),
    )
    .join("\n\n")
}

export const search = (
  http: HttpClient.HttpClient,
  input: Schema.Schema.Type<typeof SearchArgs>,
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    const api = key()
    if (!api) return "Perplexity web search requires an API key. Set PERPLEXITY_API_KEY to enable web search."

    const request = yield* HttpClientRequest.post(URL).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(api),
      HttpClientRequest.setHeader(PERPLEXITY_INTEGRATION_HEADER, perplexityIntegrationValue()),
      HttpClientRequest.schemaBodyJson(SearchRequest)(body(input)),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error("perplexity_search request timed out")),
        }),
      )
    const text = yield* response.text
    const data = yield* decode(text)
    return format(data.results)
  })
