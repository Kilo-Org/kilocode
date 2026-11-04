import { expect, spyOn } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { digest, request, retryTime } from "../src/session-sync/protocol"

const it = testEffect(Layer.empty)
const token = "isolated-protocol-fixture-credential"

for (const status of [200, 503]) {
  it.live(`bounds and cancels oversized chunked HTTP ${status} responses`, () =>
    Effect.gen(function* () {
      const cancelled = Promise.withResolvers<void>()
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    // Send beyond the bound, then leave the body open until the client explicitly cancels.
                    controller.enqueue(new TextEncoder().encode(token.repeat(4096)))
                  },
                  pull() {
                    return cancelled.promise
                  },
                  cancel() {
                    cancelled.resolve()
                  },
                }),
                { status, headers: { "content-type": "application/json" } },
              ),
          }),
        ),
        (server) =>
          Effect.sync(() => {
            server.stop(true)
          }),
      )
      const result = yield* request(`${server.url}response`, token).pipe(Effect.result)
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          code: "response_too_large",
          retryable: status >= 500,
          message: "The sync service returned an oversized response; pending changes are retained",
        },
      })
      expect(JSON.stringify(result)).not.toContain(token)
      yield* Effect.promise(() => cancelled.promise)
    }),
  )
}

it.live("decodes bounded JSON split across UTF-8 chunks and preserves retryable service errors", () =>
  Effect.gen(function* () {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: 1, sessionID: "ses_ bounded Unicode 🦉", position: 4 }),
    )
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (incoming) =>
            new URL(incoming.url).pathname === "/error"
              ? Response.json(
                  { error: { code: "upload_in_progress", retryAt: 12345, message: token } },
                  { status: 409 },
                )
              : new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
                      controller.close()
                    },
                  }),
                ),
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true)
        }),
    )
    expect(yield* request(`${server.url}state`, token)).toEqual({
      version: 1,
      sessionID: "ses_ bounded Unicode 🦉",
      position: 4,
    })
    expect(yield* request(`${server.url}error`, token).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: {
        code: "upload_in_progress",
        retryable: true,
        retryAt: 12345,
        message: "Sync service rejected the request (upload_in_progress)",
      },
    })
  }),
)

it.live("rejects redirects without sending credentials to the redirect destination", () =>
  Effect.gen(function* () {
    const received: string[] = []
    const target = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (incoming) => {
            received.push(incoming.headers.get("authorization") ?? "")
            return Response.json({ leaked: true })
          },
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true)
        }),
    )
    const redirect = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => Response.redirect(`${target.url}must-not-receive`, 307),
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true)
        }),
    )
    expect(yield* request(`${redirect.url}exchange`, token, "POST", '{"version":1}').pipe(Effect.result)).toMatchObject(
      { _tag: "Failure", failure: { code: "network_error", retryable: true } },
    )
    expect(received).toEqual([])
  }),
)

it.live(
  "allows a maximum-size blob to finish beyond the metadata request deadline",
  () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array(8 * 1024 * 1024)
      bytes[0] = 1
      bytes[bytes.length - 1] = 2
      const hash = digest(bytes)
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (incoming) => {
              const received = new Uint8Array(await incoming.arrayBuffer())
              // Exercise the native AbortSignal deadline over a real socket; fake clocks do not
              // drive the platform fetch timer. Finish beyond its former fixed 30-second ceiling.
              await Bun.sleep(31_000)
              return Response.json({ hash: digest(received), bytes: received.byteLength })
            },
          }),
        ),
        (server) =>
          Effect.sync(() => {
            server.stop(true)
          }),
      )
      expect(yield* request(`${server.url}blob`, token, "PUT", bytes)).toEqual({
        hash,
        bytes: bytes.byteLength,
      })
    }),
  40_000,
)

it.live("cancels an open response body when interrupted after HTTP headers", () =>
  Effect.gen(function* () {
    const entered = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    const nativeFetch = globalThis.fetch
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (...args: Parameters<typeof fetch>) => {
              const response = await nativeFetch(...args)
              if (response.body) {
                const getReader = response.body.getReader.bind(response.body)
                Object.defineProperty(response.body, "getReader", {
                  value() {
                    entered.resolve()
                    return getReader()
                  },
                })
              }
              return response
            },
            { preconnect: nativeFetch.preconnect },
          ),
        ),
      ),
      (fetch) => Effect.sync(() => fetch.mockRestore()),
    )
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"version":'))
                },
                pull() {
                  return cancelled.promise
                },
                cancel() {
                  cancelled.resolve()
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true)
        }),
    )
    const reading = yield* request(`${server.url}open-response`, token).pipe(Effect.forkScoped)
    yield* Effect.promise(() => entered.promise)
    yield* Fiber.interrupt(reading)
    expect((yield* Effect.promise(() => cancelled.promise).pipe(Effect.timeoutOption(1000)))._tag).toBe("Some")
  }),
)

it.live("full jitter spans the backoff window after the server retry floor", () =>
  Effect.sync(() => {
    for (const attempts of [0, 1, 5, 6, 30]) {
      const cap = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))
      expect(retryTime(attempts, 200_000, 100_000, 0)).toBe(200_000)
      expect(retryTime(attempts, 200_000, 100_000, 0.5)).toBe(200_000 + cap / 2)
      expect(retryTime(attempts, 200_000, 100_000, 0.99999)).toBeLessThan(200_000 + cap)
      expect(retryTime(attempts, 0, 100_000, 0)).toBe(100_000)
    }
  }),
)

for (const status of [429, 503]) {
  for (const format of ["seconds", "date", "body"] as const) {
    it.live(`honors ${format} Retry-After and JSON retryAt on HTTP ${status}`, () =>
      Effect.gen(function* () {
        const now = Date.now()
        const floor = Math.ceil((now + 120_000) / 1000) * 1000
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: () =>
                Response.json(
                  {
                    error: { code: "rate_limited", retryAt: format === "body" ? floor + 60_000 : now + 10_000 },
                  },
                  {
                    status,
                    headers: { "Retry-After": format === "seconds" ? "120" : new Date(floor).toUTCString() },
                  },
                ),
            }),
          ),
          (server) =>
            Effect.sync(() => {
              server.stop(true)
            }),
        )
        const result = yield* request(`${server.url}limited`, token).pipe(Effect.result)
        if (result._tag !== "Failure") return yield* Effect.die("Expected a rate limit")
        expect(result.failure.code).toBe("rate_limited")
        expect(result.failure.retryable).toBe(true)
        expect(result.failure.retryAt).toBeGreaterThanOrEqual(format === "body" ? floor + 60_000 : now + 120_000)
      }),
    )
  }
}

it.live("tenant quota pauses and blob_missing preserves its recoverable hash", () =>
  Effect.gen(function* () {
    const hash = digest("missing")
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) =>
            new URL(request.url).pathname === "/quota"
              ? Response.json(
                  { error: { code: "tenant_budget_exceeded", details: { sessions: 1, bytes: 2 } } },
                  { status: 413 },
                )
              : Response.json({ error: { code: "blob_missing", details: { hash } } }, { status: 409 }),
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true)
        }),
    )
    expect(yield* request(`${server.url}quota`, token).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "tenant_budget_exceeded", retryable: false },
    })
    expect(yield* request(`${server.url}missing`, token).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "blob_missing", retryable: true, hash },
    })
  }),
)
