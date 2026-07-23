// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http"
import {
  KILO_EXA_URL,
  MAX_KILO_EXA_RESULTS,
  type KiloExaParams,
  callKiloExa,
} from "../../../src/kilocode/tool/websearch-kilo-exa"

type Recorded = {
  url?: string
  method?: string
  authorization?: string
  body?: string
}

const readBody = async (body: HttpBody.HttpBody): Promise<string> => {
  if (body._tag === "Uint8Array") return new TextDecoder().decode(body.body)
  if (body._tag === "Raw") return JSON.stringify(body.body)
  return ""
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const okJson = (body: unknown) => jsonResponse(200, body)

const fakeHttp = (respond: (status: number) => Response, recorded?: Recorded): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const url = request.url
      const method = request.method
      const authorization = request.headers["authorization"]
      const body = yield* Effect.promise(() => readBody(request.body))
      if (recorded) {
        recorded.url = url
        recorded.method = method
        recorded.authorization = authorization
        recorded.body = body
      }
      return HttpClientResponse.fromWeb(
        request as unknown as Parameters<typeof HttpClientResponse.fromWeb>[0],
        respond(200),
      )
    }),
  )

const runCall = async (
  params: KiloExaParams,
  respond: (status: number) => Response,
  recorded?: Recorded,
  kiloToken = "kilo-test-token",
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const http = fakeHttp(respond, recorded)
      return yield* callKiloExa(http, params, kiloToken)
    }),
  )

describe("callKiloExa request shape", () => {
  test("posts to KILO_EXA_URL with bearer token and highlights-only contents", async () => {
    const recorded: Recorded = {}
    const exit = await runCall({ query: "drone" }, () => okJson({ results: [] }), recorded)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(recorded.url).toContain("/api/exa/search")
    expect(recorded.method).toBe("POST")
    expect(recorded.authorization).toBe("Bearer kilo-test-token")
    const parsed = JSON.parse(recorded.body!)
    expect(parsed.query).toBe("drone")
    expect(parsed.type).toBe("auto")
    expect(parsed.numResults).toBe(MAX_KILO_EXA_RESULTS)
    expect(parsed.contents).toEqual({ highlights: true })
  })

  test("uses caller numResults when below cap", async () => {
    const recorded: Recorded = {}
    await runCall({ query: "x", numResults: 3 }, () => okJson({ results: [] }), recorded)
    expect(JSON.parse(recorded.body!).numResults).toBe(3)
  })

  test("clamps numResults at MAX_KILO_EXA_RESULTS", async () => {
    const recorded: Recorded = {}
    await runCall({ query: "x", numResults: 25 }, () => okJson({ results: [] }), recorded)
    expect(JSON.parse(recorded.body!).numResults).toBe(MAX_KILO_EXA_RESULTS)
  })

  test("passes through caller type", async () => {
    const recorded: Recorded = {}
    await runCall({ query: "x", type: "deep" }, () => okJson({ results: [] }), recorded)
    expect(JSON.parse(recorded.body!).type).toBe("deep")
  })

  test("KILO_EXA_URL is built from KILO_API_BASE", () => {
    expect(KILO_EXA_URL).toMatch(/\/api\/exa\/search$/)
  })
})

describe("callKiloExa response formatting", () => {
  const okValue = <E>(exit: Exit.Exit<string, E>): string => {
    if (Exit.isFailure(exit)) throw new Error("expected success")
    return (exit as Extract<typeof exit, { _tag: "Success" }>).value as string
  }

  test("formats results with title, url, date and highlights", async () => {
    const exit = await runCall({ query: "x" }, () =>
      okJson({
        results: [
          {
            title: "A drone",
            url: "https://example.com/a",
            publishedDate: "2025-01-02T00:00:00.000Z",
            highlights: ["first", "second"],
          },
        ],
      }),
    )
    const text = okValue(exit)
    expect(text).toContain("[1] A drone")
    expect(text).toContain("https://example.com/a")
    expect(text).toContain("(2025-01-02T00:00:00.000Z)")
    expect(text).toContain("> first")
    expect(text).toContain("> second")
  })

  test("falls back to url when title is missing", async () => {
    const exit = await runCall({ query: "x" }, () => okJson({ results: [{ url: "https://example.com/no-title" }] }))
    expect(okValue(exit)).toContain("[1] https://example.com/no-title")
  })

  test("returns NO_RESULTS message on empty results", async () => {
    const exit = await runCall({ query: "x" }, () => okJson({ results: [] }))
    expect(okValue(exit)).toBe("No search results found. Please try a different query.")
  })

  test("ignores costDollars on the response (cost accounting out of scope)", async () => {
    const exit = await runCall({ query: "x" }, () =>
      okJson({
        results: [{ url: "https://example.com" }],
        costDollars: { total: 0.007, search: { neural: 0.007 } },
        requestId: "req-123",
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})

describe("callKiloExa error handling", () => {
  test("dies with auth-required message on 401", async () => {
    const exit = await runCall({ query: "x" }, () => jsonResponse(401, {}))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(String((exit as Extract<typeof exit, { _tag: "Failure" }>).cause)).toContain("unauthorized")
    expect(String((exit as Extract<typeof exit, { _tag: "Failure" }>).cause)).toContain("kilo auth login")
  })

  test("dies with auth-required message on 403", async () => {
    const exit = await runCall({ query: "x" }, () => jsonResponse(403, {}))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(String((exit as Extract<typeof exit, { _tag: "Failure" }>).cause)).toContain("unauthorized")
  })

  test("dies with status code on other non-2xx", async () => {
    const exit = await runCall({ query: "x" }, () => jsonResponse(500, { error: "boom" }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(String((exit as Extract<typeof exit, { _tag: "Failure" }>).cause)).toContain("500")
  })

  test("dies when response body is not valid ExaResponse shape", async () => {
    const exit = await runCall({ query: "x" }, () => okJson({ nope: true }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
