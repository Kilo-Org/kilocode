// kilocode_change - new file

import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import {
  PERPLEXITY_INTEGRATION_HEADER,
  perplexityIntegrationValue,
} from "../../src/kilocode/provider/provider"
import * as PerplexitySearch from "../../src/tool/perplexity-search"

const original = {
  perplexity: process.env.PERPLEXITY_API_KEY,
  pplx: process.env.PPLX_API_KEY,
}

const unset = () => {
  delete process.env.PERPLEXITY_API_KEY
  delete process.env.PPLX_API_KEY
}

const restore = () => {
  if (original.perplexity === undefined) delete process.env.PERPLEXITY_API_KEY
  else process.env.PERPLEXITY_API_KEY = original.perplexity

  if (original.pplx === undefined) delete process.env.PPLX_API_KEY
  else process.env.PPLX_API_KEY = original.pplx
}

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], data: unknown) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  )

const read = (req: Parameters<typeof HttpClientResponse.fromWeb>[0]) => {
  if (req.body._tag !== "Uint8Array") throw new Error("expected JSON body")
  return JSON.parse(new TextDecoder().decode(req.body.body))
}

afterEach(() => {
  restore()
})

describe("perplexity search", () => {
  test("uses PERPLEXITY_API_KEY for authorization", async () => {
    unset()
    process.env.PERPLEXITY_API_KEY = "primary-key"

    const seen: Record<string, string | undefined> = {}
    const http = HttpClient.make((req) => {
      seen.auth = req.headers.authorization
      return Effect.succeed(json(req, { results: [] }))
    })

    await Effect.runPromise(PerplexitySearch.search(http, { query: "kilo" }, "25 seconds"))

    expect(seen.auth).toBe("Bearer primary-key")
  })

  test("falls back to PPLX_API_KEY when PERPLEXITY_API_KEY is unset", async () => {
    unset()
    process.env.PPLX_API_KEY = "fallback-key"

    const seen: Record<string, string | undefined> = {}
    const http = HttpClient.make((req) => {
      seen.auth = req.headers.authorization
      return Effect.succeed(json(req, { results: [] }))
    })

    await Effect.runPromise(PerplexitySearch.search(http, { query: "kilo" }, "25 seconds"))

    expect(seen.auth).toBe("Bearer fallback-key")
  })

  test("sends mapped request body and integration header", async () => {
    unset()
    process.env.PERPLEXITY_API_KEY = "primary-key"

    const seen: {
      body?: unknown
      header?: string
    } = {}
    const http = HttpClient.make((req) => {
      seen.body = read(req)
      seen.header = req.headers[PERPLEXITY_INTEGRATION_HEADER.toLowerCase()]
      return Effect.succeed(json(req, { results: [] }))
    })

    await Effect.runPromise(
      PerplexitySearch.search(
        http,
        {
          query: "latest ai news",
          numResults: 3,
          contextMaxCharacters: 120,
        },
        "25 seconds",
      ),
    )

    expect(seen.body).toEqual({
      query: "latest ai news",
      max_results: 3,
      max_tokens_per_page: 64,
    })
    expect(seen.header).toBe(perplexityIntegrationValue())
  })

  test("formats multiple results with title, url, and snippet", async () => {
    unset()
    process.env.PERPLEXITY_API_KEY = "primary-key"

    const http = HttpClient.make((req) =>
      Effect.succeed(
        json(req, {
          results: [
            {
              title: "First result",
              url: "https://example.com/first",
              snippet: "First snippet.",
            },
            {
              title: "Second result",
              url: "https://example.com/second",
              snippet: "Second snippet.",
            },
          ],
        }),
      ),
    )

    const result = await Effect.runPromise(PerplexitySearch.search(http, { query: "kilo" }, "25 seconds"))

    expect(result).toContain("First result")
    expect(result).toContain("https://example.com/first")
    expect(result).toContain("First snippet.")
    expect(result).toContain("Second result")
    expect(result).toContain("https://example.com/second")
    expect(result).toContain("Second snippet.")
  })

  test("returns a helpful error string when the API key is missing", async () => {
    unset()

    const http = HttpClient.make((req) => Effect.succeed(json(req, { results: [] })))
    const result = await Effect.runPromise(PerplexitySearch.search(http, { query: "kilo" }, "25 seconds"))

    expect(result).toContain("Set PERPLEXITY_API_KEY")
  })
})
