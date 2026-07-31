import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Queue, Schema, Stream } from "effect"
import * as Sse from "effect/unstable/encoding/Sse" // kilocode_change - decode the legacy SSE wire format
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
// kilocode_change start - verify transformed EventV2 values at the legacy SSE boundary
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { DateTime, Fiber } from "effect"
import { GlobalBus } from "../../src/bus/global"
import { Bus } from "../../src/bus"
import { InstanceRef } from "../../src/effect/instance-ref"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { SessionID } from "../../src/session/schema"
import { Server } from "../../src/server/server"
import { SessionMessageID } from "@opencode-ai/core/session/message-id"
// kilocode_change end
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect, testEffectShared } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

// kilocode_change start - inspect the real global SSE envelope
const GlobalEventData = Schema.Struct({
  directory: Schema.optional(Schema.String),
  payload: Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.String,
    properties: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  }),
})
// kilocode_change end

// kilocode_change start - instance SSE also carries Kilo's legacy Bus events and `sync` envelopes
const takeFrame = (reader: Queue.Dequeue<unknown>) =>
  Queue.take(reader).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for event")),
    }),
  )

const readEvent = (reader: Queue.Dequeue<unknown>) =>
  Effect.map(takeFrame(reader), (frame) => Schema.decodeUnknownSync(EventData)(frame))

/** Skip Kilo's ambient instance events (indexing.status, sync envelopes, ...) until `type` shows up. */
const readEventOfType = (reader: Queue.Dequeue<unknown>, type: string) =>
  Effect.gen(function* () {
    while (true) {
      const frame = yield* takeFrame(reader)
      if (typeof frame === "object" && frame !== null && (frame as { type?: string }).type === type) {
        return Schema.decodeUnknownSync(EventData)(frame)
      }
    }
  })

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    const reader = yield* Queue.unbounded<unknown>()
    yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.runForEach((event) => Queue.offer(reader, JSON.parse(event.data) as unknown)),
      Effect.forkScoped,
    )
    return { response, reader }
  })
// kilocode_change end

// kilocode_change start - read transformed values from the global SSE wire payload
const ready = (count: number) =>
  Effect.gen(function* () {
    while (GlobalBus.listenerCount("event") <= count) yield* Effect.sleep("10 millis")
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("global event stream did not subscribe")),
    }),
  )

const readGlobal = (reader: ReadableStreamDefaultReader<Uint8Array>, delay = 5_000) =>
  Effect.gen(function* () {
    if (delay <= 0) return yield* Effect.fail(new Error("timed out waiting for event"))
    const result = yield* Effect.promise(() => reader.read()).pipe(
      Effect.timeoutOrElse({
        duration: delay,
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    if (result.done || !result.value) return yield* Effect.fail(new Error("global event stream closed"))
    return Schema.decodeUnknownSync(GlobalEventData)(
      JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")),
    )
  })

function properties(event: Schema.Schema.Type<typeof GlobalEventData>) {
  if (!event.payload.properties) throw new Error(`event ${event.payload.type} has no properties`)
  return event.payload.properties
}

const readGlobalUntil = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: Schema.Schema.Type<typeof GlobalEventData>) => boolean,
  delay = 5_000,
) =>
  Effect.gen(function* () {
    const end = Date.now() + delay
    while (true) {
      const event = yield* readGlobal(reader, end - Date.now())
      if (predicate(event)) return event
    }
  })
// kilocode_change end

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain("text/event-stream")
        expect(response.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(response.headers["x-accel-buffering"]).toBe("no")
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        // kilocode_change - the instance stream also carries Kilo's ambient events (indexing.status, sync
        // envelopes), so receiving one is equally proof the stream stayed open after server.connected.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(["open", "event"]).toContain(status)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        // kilocode_change - skip ambient instance events that may interleave before session.created
        expect(yield* readEventOfType(reader, "session.created")).toMatchObject({ type: "session.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  // kilocode_change start - transformed EventV2 data is numeric on legacy SSE while domain data stays decoded
  const v2 = testEffectShared(Layer.mergeAll(Bus.defaultLayer, EventV2Bridge.defaultLayer))

  v2.instance(
    "encodes catalog and session EventV2 data on the global event stream",
    () =>
      Effect.gen(function* () {
        const count = GlobalBus.listenerCount("event")
        const response = yield* Effect.promise(async () => Server.Default().app.request(GlobalPaths.event))
        if (!response.body) return yield* Effect.die("missing response body")
        const reader = response.body.getReader()
        yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => undefined)))

        expect(yield* readGlobal(reader)).toMatchObject({ payload: { type: "server.connected", properties: {} } })
        yield* ready(count)
        const events = yield* EventV2Bridge.Service
        const catalogID = EventV2.ID.create()
        const catalog = yield* readGlobalUntil(reader, (event) => event.payload.id === catalogID).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        const catalogDomain = yield* events.publish(Catalog.Event.Updated, {}, { id: catalogID })

        expect(catalogDomain.data).toEqual({})
        expect(properties(yield* Fiber.join(catalog))).toEqual({})

        const globalID = EventV2.ID.create()
        const global = yield* readGlobalUntil(reader, (event) => event.payload.id === globalID).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        yield* events
          .publish(Catalog.Event.Updated, {}, { id: globalID })
          .pipe(Effect.provideService(InstanceRef, undefined))
        expect((yield* Fiber.join(global)).directory).toBe("global")

        const timestamp = DateTime.makeUnsafe(1_234)
        // kilocode_change - session.next.prompted is a durable event whose projector writes a session_message
        // row, so it needs a real session to satisfy the foreign key. Create one through the server.
        const { directory } = yield* TestInstance
        const sessionID = yield* Effect.promise(async () => {
          const created = await Server.Default().app.request("/session", {
            method: "POST",
            headers: { "x-kilo-directory": directory, "content-type": "application/json" },
            body: "{}",
          })
          const body = (await created.json()) as { id: string }
          return SessionID.make(body.id)
        })
        const session = yield* readGlobalUntil(
          reader,
          (event) => event.payload.type === SessionEvent.Text.Delta.type && properties(event).sessionID === sessionID,
        ).pipe(Effect.forkChild({ startImmediately: true }))
        const sessionDomain = yield* events.publish(SessionEvent.Text.Delta, {
          sessionID,
          timestamp,
          assistantMessageID: SessionMessageID.ID.create(),
          textID: "text-event-encoding",
          delta: "hello",
        })

        expect(DateTime.isDateTime(sessionDomain.data.timestamp)).toBe(true)
        expect(properties(yield* Fiber.join(session)).timestamp).toBe(1_234)

        const prompted = yield* readGlobalUntil(
          reader,
          (event) => event.payload.type === SessionEvent.Prompted.type,
        ).pipe(Effect.forkChild({ startImmediately: true }))
        yield* events.publish(SessionEvent.Prompted, {
          sessionID,
          timestamp,
          messageID: SessionMessageID.ID.create(),
          delivery: "queue",
          prompt: new Prompt({ text: "hello", files: [], agents: [] }), // kilocode_change - upstream made prompt a Prompt class
        })
        expect(properties(yield* Fiber.join(prompted))).toMatchObject({
          timestamp: 1_234,
          prompt: { text: "hello" },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
  // kilocode_change end
})
