import { afterEach, describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Bus } from "../../src/bus"
import { Event as ServerEvent } from "../../src/server/event"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
// kilocode_change start - verify transformed EventV2 values at the legacy SSE boundary
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { DateTime, Fiber, Layer } from "effect"
import { GlobalBus } from "../../src/bus/global"
import { InstanceRef } from "../../src/effect/instance-ref"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { SessionID } from "../../src/session/schema"
// kilocode_change end
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffectShared } from "../lib/effect"

void Log.init({ print: false })

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

const readEvent = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => reader.read()).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    if (result.done || !result.value) return yield* Effect.fail(new Error("event stream closed"))
    return Schema.decodeUnknownSync(EventData)(
      JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")),
    )
  })

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(async () =>
      Server.Default().app.request(EventPaths.event, { headers: { "x-kilo-directory": directory } }),
    )
    if (!response.body) return yield* Effect.die("missing SSE response body")
    const reader = response.body.getReader()
    yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => undefined)))
    return { response, reader }
  })

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

const it = testEffectShared(Bus.defaultLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("text/event-stream")
        expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
        expect(response.headers.get("x-accel-buffering")).toBe("no")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
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

        // If no second event arrives within 250ms, the stream is still open.
        const status = yield* Effect.promise(() => reader.read()).pipe(
          Effect.map((result) => (result.done ? ("closed" as const) : ("event" as const))),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance bus events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        yield* Bus.use.publish(ServerEvent.Connected, {})
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
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
        const released = DateTime.makeUnsafe(1_750_000_000_123)
        const model = new ModelV2.Info({
          ...ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("model")),
          time: { released },
        })
        const catalogID = EventV2.ID.create()
        const catalog = yield* readGlobalUntil(reader, (event) => event.payload.id === catalogID).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        const catalogDomain = yield* events.publish(Catalog.Event.ModelUpdated, { model }, { id: catalogID })

        expect(DateTime.isDateTime(catalogDomain.data.model.time.released)).toBe(true)
        expect(properties(yield* Fiber.join(catalog)).model.time.released).toBe(1_750_000_000_123)

        const globalID = EventV2.ID.create()
        const global = yield* readGlobalUntil(reader, (event) => event.payload.id === globalID).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        yield* events
          .publish(Catalog.Event.ModelUpdated, { model }, { id: globalID })
          .pipe(Effect.provideService(InstanceRef, undefined))
        expect((yield* Fiber.join(global)).directory).toBe("global")

        const timestamp = DateTime.makeUnsafe(1_234)
        const sessionID = SessionID.make("ses_event_encoding")
        const session = yield* readGlobalUntil(
          reader,
          (event) => event.payload.type === SessionEvent.Text.Delta.type && properties(event).sessionID === sessionID,
        ).pipe(Effect.forkChild({ startImmediately: true }))
        const sessionDomain = yield* events.publish(SessionEvent.Text.Delta, {
          sessionID,
          timestamp,
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
          prompt: { text: "hello", files: [], agents: [], references: [] },
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
