import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import path from "node:path"

import { Agent } from "../../src/agent/agent"
import { WithInstance } from "../../src/project/with-instance"
import { MessageID, SessionID } from "../../src/session/schema"
import {
  Parameters as SearchParameters,
  PERPLEXITY_INTEGRATION_HEADER,
  PERPLEXITY_SEARCH_URL,
  WebSearchTool,
  perplexityIntegrationValue,
} from "../../src/tool/websearch"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const PRIMARY_KEY = "pplx-primary"
const FALLBACK_KEY = "pplx-fallback"
const QUERY = "effect schema release notes"
const COUNTRY = "US"
const FIRST_TITLE = "Effect 4 release notes"
const FIRST_URL = "https://effect.website/releases/effect-4"
const FIRST_SNIPPET = "Effect 4 includes updated Schema APIs."
const FIRST_DATE = "2026-01-15"
const SECOND_TITLE = "Effect Schema docs"
const SECOND_URL = "https://effect.website/docs/schema"
const SECOND_SNIPPET = "Schema docs describe decoding and validation."
const SECOND_DATE = "2026-01-20"
const project = path.join(import.meta.dir, "../..")

const original = {
  fetch: globalThis.fetch,
  perplexity: process.env["PERPLEXITY_API_KEY"],
  pplx: process.env["PPLX_API_KEY"],
}

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const sample = {
  results: [
    {
      title: FIRST_TITLE,
      url: FIRST_URL,
      snippet: FIRST_SNIPPET,
      date: FIRST_DATE,
      last_updated: "2026-01-16",
    },
    {
      title: SECOND_TITLE,
      url: SECOND_URL,
      snippet: SECOND_SNIPPET,
      date: SECOND_DATE,
      last_updated: "2026-01-21",
    },
  ],
  id: "search_123",
  server_time: "2026-01-21T00:00:00Z",
}

type Call = {
  input: Parameters<typeof fetch>[0]
  init: Parameters<typeof fetch>[1]
}

afterEach(() => {
  globalThis.fetch = original.fetch
  restore("PERPLEXITY_API_KEY", original.perplexity)
  restore("PPLX_API_KEY", original.pplx)
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function mockFetch(body = sample) {
  const calls: Call[] = []
  setFetch((input, init) => {
    calls.push({ input, init })
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })
  return calls
}

function setFetch(
  fn: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = Object.assign(fn, {
    preconnect: original.fetch.preconnect,
  })
}

function requests(calls: Call[]) {
  return calls.filter((call) => call.input === PERPLEXITY_SEARCH_URL)
}

function payload(call: Call) {
  if (typeof call.init?.body !== "string") throw new Error("expected string request body")
  return JSON.parse(call.init.body)
}

function exec(input: unknown) {
  const params = Schema.decodeUnknownSync(SearchParameters)(input)
  return WithInstance.provide({
    directory: project,
    fn: () =>
      WebSearchTool.pipe(
        Effect.flatMap((info) => info.init()),
        Effect.flatMap((tool) => tool.execute(params, ctx)),
        Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer)),
        Effect.runPromise,
      ),
  })
}

describe("perplexity websearch tool", () => {
  test("sends a Perplexity Search request with attribution and formats results", async () => {
    process.env["PERPLEXITY_API_KEY"] = PRIMARY_KEY
    delete process.env["PPLX_API_KEY"]
    const calls = mockFetch()

    const result = await exec({ query: QUERY, max_results: 3, country: COUNTRY })
    const search = requests(calls)

    expect(search.length).toBe(1)
    expect(search[0].input).toBe(PERPLEXITY_SEARCH_URL)
    expect(search[0].init?.method).toBe("POST")
    expect(search[0].init?.headers).toEqual({
      Authorization: `Bearer ${PRIMARY_KEY}`,
      "Content-Type": "application/json",
      [PERPLEXITY_INTEGRATION_HEADER]: perplexityIntegrationValue(),
    })
    expect(payload(search[0])).toEqual({
      query: QUERY,
      max_results: 3,
      country: COUNTRY,
    })
    expect(result.output).toBe(
      [
        `1. ${FIRST_TITLE}`,
        `URL: ${FIRST_URL}`,
        `Date: ${FIRST_DATE}`,
        `Snippet: ${FIRST_SNIPPET}`,
        "",
        `2. ${SECOND_TITLE}`,
        `URL: ${SECOND_URL}`,
        `Date: ${SECOND_DATE}`,
        `Snippet: ${SECOND_SNIPPET}`,
      ].join("\n"),
    )
  })

  test("uses PPLX_API_KEY when PERPLEXITY_API_KEY is unset", async () => {
    delete process.env["PERPLEXITY_API_KEY"]
    process.env["PPLX_API_KEY"] = FALLBACK_KEY
    const calls = mockFetch()

    await exec({ query: QUERY })
    const search = requests(calls)

    expect(search.length).toBe(1)
    expect(search[0].init?.headers).toEqual({
      Authorization: `Bearer ${FALLBACK_KEY}`,
      "Content-Type": "application/json",
      [PERPLEXITY_INTEGRATION_HEADER]: perplexityIntegrationValue(),
    })
    expect(payload(search[0])).toEqual({
      query: QUERY,
      max_results: 5,
    })
  })

  test("prefers PERPLEXITY_API_KEY over PPLX_API_KEY", async () => {
    process.env["PERPLEXITY_API_KEY"] = PRIMARY_KEY
    process.env["PPLX_API_KEY"] = FALLBACK_KEY
    const calls = mockFetch()

    await exec({ query: QUERY })
    const search = requests(calls)

    expect(search.length).toBe(1)
    expect(search[0].init?.headers).toEqual({
      Authorization: `Bearer ${PRIMARY_KEY}`,
      "Content-Type": "application/json",
      [PERPLEXITY_INTEGRATION_HEADER]: perplexityIntegrationValue(),
    })
  })

  test("returns a clean setup message when no key is configured", async () => {
    delete process.env["PERPLEXITY_API_KEY"]
    delete process.env["PPLX_API_KEY"]
    let called = false
    setFetch(() => {
      called = true
      return Promise.reject(new Error("fetch should not be called"))
    })

    const result = await exec({ query: QUERY })

    expect(called).toBe(false)
    expect(result.output).toContain("PERPLEXITY_API_KEY")
    expect(result.output).toContain("PPLX_API_KEY")
  })
})
