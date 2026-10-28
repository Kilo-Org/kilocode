import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { request } from "../src/session-sync/protocol"

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
