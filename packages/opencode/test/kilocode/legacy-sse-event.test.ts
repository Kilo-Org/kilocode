import { afterEach, describe, expect } from "bun:test"
import { Effect, Queue, Stream } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"
import { Bus } from "../../src/bus"
import { GlobalBus } from "../../src/bus/global"
import { Changed } from "../../src/kilocode/sandbox/event"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

type Frame = {
  type?: string
  properties?: Record<string, unknown>
  syncEvent?: {
    type?: string
    aggregateID?: string
    data?: unknown
  }
}

const parse = (value: unknown): Frame => (typeof value === "object" && value !== null ? (value as Frame) : {})

const take = (reader: Queue.Dequeue<unknown>, match: (frame: Frame) => boolean) =>
  Effect.gen(function* () {
    while (true) {
      const frame = parse(yield* Queue.take(reader))
      if (match(frame)) return frame
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for SSE event")),
    }),
  )

const open = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    expect(response.status).toBe(200)

    const reader = yield* Queue.unbounded<unknown>()
    yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.runForEach((event) => Effect.sync(() => Queue.offerUnsafe(reader, JSON.parse(event.data) as unknown))),
      Effect.forkScoped,
    )
    expect((yield* take(reader, (frame) => frame.type === "server.connected")).properties).toEqual({})
    return reader
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("legacy instance SSE", () => {
  it.instance(
    "delivers legacy Bus events without leaking another directory or workspace",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const ctx = yield* requireInstance
        const reader = yield* open(directory)
        const foreign = SessionID.make("ses_sse_foreign")
        const local = SessionID.make("ses_sse_local")

        yield* Effect.promise(() =>
          Bus.publish({ ...ctx, directory: `${directory}-foreign` }, Changed, {
            sessionID: foreign,
            directory: `${directory}-foreign`,
            enabled: true,
            available: true,
            version: 1,
          }),
        )
        GlobalBus.emit("event", {
          directory,
          workspace: "wrk_foreign",
          payload: {
            type: Changed.type,
            properties: {
              sessionID: foreign,
              directory,
              enabled: true,
              available: true,
              version: 1,
            },
          },
        })
        yield* Effect.promise(() =>
          Bus.publish(ctx, Changed, {
            sessionID: local,
            directory,
            enabled: true,
            available: true,
            version: 2,
          }),
        )

        expect((yield* take(reader, (frame) => frame.type === Changed.type)).properties).toMatchObject({
          sessionID: local,
          directory,
          version: 2,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers versioned sync envelopes from EventV2",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const reader = yield* open(directory)
        const response = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(response.status).toBe(200)
        const session = (yield* response.json) as { id: string }

        const frame = yield* take(
          reader,
          (event) => event.type === "sync" && event.syncEvent?.type === "session.created.1",
        )
        expect(frame.syncEvent).toMatchObject({
          type: "session.created.1",
          aggregateID: session.id,
          data: { sessionID: session.id, info: { id: session.id } },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
