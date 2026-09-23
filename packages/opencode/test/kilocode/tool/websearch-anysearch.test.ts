import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../../src/agent/agent"
import { Auth } from "../../../src/auth"
import { Permission } from "../../../src/permission"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Env } from "../../../src/env"
import { MessageID, SessionID } from "../../../src/session/schema"
import type { Tool } from "../../../src/tool/tool"
import { Truncate } from "../../../src/tool/truncate"
import { WebSearchTool, selectWebSearchProvider, webSearchProviderLabel } from "../../../src/tool/websearch"
import {
  ANYSEARCH_URL,
  MAX_ANYSEARCH_RESULTS,
  callAnySearch,
  type AnySearchParams,
} from "../../../src/kilocode/tool/websearch-anysearch"

type Recorded = {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

const id = "123e4567-e89b-12d3-a456-426614174000"
const ok = (results: unknown[], extra: Record<string, unknown> = {}) => ({
  code: 0,
  message: "success",
  request_id: id,
  data: { results, metadata: { total_results: results.length, search_time_ms: 12 } },
  ...extra,
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const run = (params: AnySearchParams, response: Response, key?: string, recorded: Recorded = {}) => {
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      recorded.url = request.url
      recorded.method = request.method
      recorded.headers = request.headers
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected body: ${request.body._tag}`)
      recorded.body = JSON.parse(new TextDecoder().decode(request.body.body))
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  return Effect.runPromiseExit(callAnySearch(http, params, key))
}

const value = <E>(exit: Exit.Exit<string, E>) => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause))
  return exit.value
}

const failure = <E>(exit: Exit.Exit<string, E>) => {
  if (Exit.isSuccess(exit)) throw new Error(`Expected failure, received: ${exit.value}`)
  return String(exit.cause)
}

describe("AnySearch provider selection", () => {
  test("selects and labels the operational override", () => {
    expect(selectWebSearchProvider("ses_anysearch", undefined, "anysearch")).toBe("anysearch")
    expect(webSearchProviderLabel("anysearch")).toBe("AnySearch Web Search")
  })

  test("the built-in tool reads the override and optional key through Env.Service", async () => {
    const info = {
      name: "code",
      mode: "primary",
      options: {},
      permission: Permission.fromConfig({}),
    } satisfies Agent.Info
    const agents = Agent.Service.of({
      get: () => Effect.succeed(info),
      list: () => Effect.succeed([info]),
      defaultInfo: () => Effect.succeed(info),
      defaultAgent: () => Effect.succeed("code"),
      generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
    })
    const truncate = Truncate.Service.of({
      cleanup: () => Effect.void,
      write: () => Effect.succeed(""),
      output: (text) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
    })
    const context: Tool.Context = {
      sessionID: SessionID.make("ses_anysearch"),
      messageID: MessageID.make("msg_anysearch"),
      agent: "code",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }

    for (const key of [undefined, "anysearch-test-secret"]) {
      const recorded: Recorded = {}
      const env = Env.Service.of({
        get: (name) => {
          if (name === "KILO_WEBSEARCH_PROVIDER") return Effect.succeed("anysearch")
          if (name === "ANYSEARCH_API_KEY") return Effect.succeed(key)
          return Effect.succeed(undefined)
        },
        all: () => Effect.succeed({}),
        set: () => Effect.void,
        remove: () => Effect.void,
      })
      const auth = Auth.Service.of({
        get: () => Effect.die("AnySearch must not read Kilo auth"),
        all: () => Effect.succeed({}),
        set: () => Effect.void,
        remove: () => Effect.void,
      })
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          recorded.headers = request.headers
          return HttpClientResponse.fromWeb(request, json(200, ok([{ title: "Result", url: "https://example.com" }])))
        }),
      )
      const layer = Layer.mergeAll(
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(Env.Service, env),
        Layer.succeed(Auth.Service, auth),
        Layer.succeed(HttpClient.HttpClient, http),
        RuntimeFlags.layer(),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tool = yield* WebSearchTool
          return yield* (yield* tool.init()).execute({ query: "Kilo Code" }, context)
        }).pipe(Effect.provide(layer)),
      )

      expect(result.title).toBe("AnySearch Web Search: Kilo Code")
      expect(result.metadata).toMatchObject({ provider: "anysearch", transport: "anysearch-rest" })
      expect(result.output).toContain("[1] Result")
      if (!key) {
        expect(recorded.headers).not.toHaveProperty("authorization")
        continue
      }
      expect(recorded.headers?.authorization).toBe(`Bearer ${key}`)
      expect(JSON.stringify(result)).not.toContain(key)
    }
  })
})

describe("AnySearch request", () => {
  test("posts query and default result count anonymously without Authorization", async () => {
    const recorded: Recorded = {}
    const exit = await run({ query: "Kilo Code" }, json(200, ok([])), undefined, recorded)

    expect(value(exit)).toBe("No search results found. Please try a different query.")
    expect(recorded.url).toBe(ANYSEARCH_URL)
    expect(recorded.method).toBe("POST")
    expect(recorded.headers).toMatchObject({ accept: "application/json", "content-type": "application/json" })
    expect(recorded.headers).not.toHaveProperty("authorization")
    expect(recorded.body).toEqual({ query: "Kilo Code", max_results: 8 })
  })

  test("uses a configured Bearer key without returning it to the model", async () => {
    const recorded: Recorded = {}
    const key = "anysearch-test-secret"
    const exit = await run(
      { query: "Kilo Code", numResults: 3 },
      json(200, ok([{ title: "Result", url: "https://example.com" }], { message: key })),
      key,
      recorded,
    )

    expect(recorded.headers?.authorization).toBe(`Bearer ${key}`)
    expect(recorded.body).toEqual({ query: "Kilo Code", max_results: 3 })
    expect(value(exit)).toContain("[1] Result")
    expect(value(exit)).not.toContain(key)
  })

  test("clamps counts to the AnySearch range", async () => {
    const high: Recorded = {}
    const low: Recorded = {}
    await run({ query: "x", numResults: 30 }, json(200, ok([])), undefined, high)
    await run({ query: "x", numResults: 0 }, json(200, ok([])), undefined, low)

    expect(high.body).toEqual({ query: "x", max_results: MAX_ANYSEARCH_RESULTS })
    expect(low.body).toEqual({ query: "x", max_results: 1 })
  })

  test.each([{ type: "deep" }, { livecrawl: "preferred" }, { contextMaxCharacters: 1000 }])(
    "rejects an unsupported control before sending a request: %j",
    async (control) => {
      const recorded: Recorded = {}
      const exit = await run({ query: "x", ...control }, json(200, ok([])), undefined, recorded)

      expect(failure(exit)).toContain("does not support")
      expect(recorded.url).toBeUndefined()
    },
  )
})

describe("AnySearch results", () => {
  test("formats title, URL, snippet, content, and a safe request ID", async () => {
    const exit = await run(
      { query: "x" },
      json(
        200,
        ok([{ title: "A result", url: "https://example.com/a", snippet: "Short summary", content: "More detail" }]),
      ),
    )

    expect(value(exit)).toBe(
      `[1] A result\nhttps://example.com/a\nSnippet: Short summary\nContent: More detail\n\nRequest ID: ${id}`,
    )
  })

  test("keeps valid siblings when one item is incomplete and accepts optional fields", async () => {
    const exit = await run(
      { query: "x" },
      json(
        200,
        ok([
          { title: "No URL" },
          null,
          { url: "https://example.com/b", snippet: null },
          { title: "C", url: "https://example.com/c", content: "Content only" },
        ]),
      ),
    )

    expect(value(exit)).toContain("[1] https://example.com/b\nhttps://example.com/b")
    expect(value(exit)).toContain("[2] C\nhttps://example.com/c\nContent: Content only")
    expect(value(exit)).not.toContain("No URL")
  })

  test("uses the no-results fallback when every item is unusable", async () => {
    const exit = await run({ query: "x" }, json(200, ok([{ title: "No URL" }])))
    expect(value(exit)).toBe("No search results found. Please try a different query.")
  })

  test("redacts a configured key even if it appears in result text", async () => {
    const key = "anysearch-test-secret"
    const exit = await run({ query: "x" }, json(200, ok([{ title: key, url: "https://example.com" }])), key)
    expect(value(exit)).toContain("[redacted]")
    expect(value(exit)).not.toContain(key)
  })
})

describe("AnySearch failures", () => {
  test("handles nonzero business code without returning provider message", async () => {
    const key = "anysearch-test-secret"
    const exit = await run({ query: "x" }, json(200, { code: 41, message: key, request_id: id }), key)
    expect(failure(exit)).toContain("code 41")
    expect(failure(exit)).toContain(id)
    expect(failure(exit)).not.toContain(key)
  })

  test("sanitizes transport failures that contain a configured key", async () => {
    const key = "anysearch-test-secret"
    const http = HttpClient.make(() => Effect.die(new Error(`request with ${key}`)))
    const exit = await Effect.runPromiseExit(callAnySearch(http, { query: "x" }, key))
    expect(failure(exit)).toContain("could not be sent")
    expect(failure(exit)).not.toContain(key)
  })

  test.each([401, 403])("reports HTTP %i without echoing provider content", async (status) => {
    const exit = await run({ query: "x" }, json(status, { message: "private provider message" }))
    expect(failure(exit)).toContain(`HTTP ${status}`)
    expect(failure(exit)).not.toContain("private provider message")
  })

  test("sanitizes HTTP 402 credentials", async () => {
    const secret = "username=user password=pass api_key=generated-secret"
    const exit = await run({ query: "x" }, json(402, { code: 402, message: secret, request_id: id }))
    expect(failure(exit)).toContain("HTTP 402")
    expect(failure(exit)).not.toContain("username")
    expect(failure(exit)).not.toContain("password")
    expect(failure(exit)).not.toContain("generated-secret")
  })

  test.each([429, 502, 500])("reports HTTP %i safely", async (status) => {
    const exit = await run({ query: "x" }, json(status, { message: "private provider message" }))
    expect(failure(exit)).toContain(`HTTP ${status}`)
    expect(failure(exit)).not.toContain("private provider message")
  })

  test("reports an invalid success body without reflecting it", async () => {
    const exit = await run({ query: "x" }, json(200, { code: 0, message: "private", data: { nope: true } }))
    expect(failure(exit)).toContain("invalid response")
    expect(failure(exit)).not.toContain("private")
  })
})
