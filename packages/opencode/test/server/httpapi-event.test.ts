import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { Event as ServerEvent } from "../../src/server/event"
// kilocode_change start - verify transformed EventV2 values at the legacy SSE boundary
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { SessionID } from "../../src/session/schema"
// kilocode_change end
import * as Log from "@opencode-ai/core/util/log"
import { DateTime, Effect, Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

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

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, delay = 5_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for event")), delay)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readFirstEvent(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  try {
    return await readEvent(reader)
  } finally {
    await reader.cancel()
  }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await readChunk(reader)
  if (result.done || !result.value) throw new Error("event stream closed")
  return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")))
}

async function expectOpen(reader: ReadableStreamDefaultReader<Uint8Array>, delay: number) {
  const end = Date.now() + delay
  while (true) {
    const remaining = end - Date.now()
    if (remaining <= 0) return

    let timeout: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      reader.read(),
      new Promise<"open">((resolve) => {
        timeout = setTimeout(() => resolve("open"), remaining)
      }),
    ])
    if (timeout) clearTimeout(timeout)
    if (result === "open") return
    if (result.done) throw new Error("event stream closed")
  }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: Schema.Schema.Type<typeof EventData>) => boolean,
  delay = 5_000,
) {
  const end = Date.now() + delay
  while (true) {
    const event = await readEventWithin(reader, end - Date.now())
    if (predicate(event)) return event
  }
}

async function readEventWithin(reader: ReadableStreamDefaultReader<Uint8Array>, delay: number) {
  if (delay <= 0) throw new Error("timed out waiting for event")
  const result = await readChunk(reader, delay)
  if (result.done || !result.value) throw new Error("event stream closed")
  return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")))
}

// kilocode_change start - read transformed values from the global SSE wire payload
async function readGlobal(reader: ReadableStreamDefaultReader<Uint8Array>, delay = 5_000) {
  const result = await readChunk(reader, delay)
  if (result.done || !result.value) throw new Error("global event stream closed")
  return Schema.decodeUnknownSync(GlobalEventData)(
    JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")),
  )
}

function properties(event: Schema.Schema.Type<typeof GlobalEventData>) {
  if (!event.payload.properties) throw new Error(`event ${event.payload.type} has no properties`)
  return event.payload.properties
}

async function readGlobalUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: Schema.Schema.Type<typeof GlobalEventData>) => boolean,
  delay = 5_000,
) {
  const end = Date.now() + delay
  while (true) {
    const event = await readGlobal(reader, end - Date.now())
    if (predicate(event)) return event
  }
}
// kilocode_change end

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("event HttpApi", () => {
  test("serves event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-kilo-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await readFirstEvent(response)).toMatchObject({ type: "server.connected", properties: {} })
  })

  test("keeps the event stream open after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-kilo-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      await expectOpen(reader, 250)
    } finally {
      await reader.cancel()
    }
  })

  test("delivers instance bus events after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-kilo-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

      const id = Bus.createID()
      const next = readUntil(reader, (event) => event.id === id && event.type === "server.connected")
      const ctx = await reloadTestInstance({ directory: tmp.path })
      await AppRuntime.runPromise(
        Bus.Service.use((svc) => svc.publish(ServerEvent.Connected, {}, { id })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      expect(await next).toMatchObject({ id, type: "server.connected", properties: {} })
    } finally {
      await reader.cancel()
    }
  })

  // kilocode_change start - transformed EventV2 data is numeric on legacy SSE while domain data stays decoded
  test("encodes catalog and session EventV2 data on the global event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(GlobalPaths.event)
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readGlobal(reader)).toMatchObject({ payload: { type: "server.connected", properties: {} } })
      const ctx = await reloadTestInstance({ directory: tmp.path })
      const released = DateTime.makeUnsafe(1_750_000_000_123)
      const model = new ModelV2.Info({
        ...ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("model")),
        time: { released },
      })
      const catalogID = EventV2.ID.create()
      const catalog = readGlobalUntil(reader, (event) => event.payload.id === catalogID)
      const catalogDomain = await AppRuntime.runPromise(
        EventV2.Service.use((events) => events.publish(Catalog.Event.ModelUpdated, { model }, { id: catalogID })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      expect(DateTime.isDateTime(catalogDomain.data.model.time.released)).toBe(true)
      expect(properties(await catalog).model.time.released).toBe(1_750_000_000_123)

      const globalID = EventV2.ID.create()
      const global = readGlobalUntil(reader, (event) => event.payload.id === globalID)
      await AppRuntime.runPromise(
        EventV2.Service.use((events) => events.publish(Catalog.Event.ModelUpdated, { model }, { id: globalID })),
      )
      expect((await global).directory).toBe("global")

      const timestamp = DateTime.makeUnsafe(1_234)
      const sessionID = SessionID.make("ses_event_encoding")
      const session = readGlobalUntil(
        reader,
        (event) => event.payload.type === SessionEvent.Text.Delta.type && properties(event).sessionID === sessionID,
      )
      const sessionDomain = await AppRuntime.runPromise(
        EventV2.Service.use((events) =>
          events.publish(SessionEvent.Text.Delta, { sessionID, timestamp, delta: "hello" }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      expect(DateTime.isDateTime(sessionDomain.data.timestamp)).toBe(true)
      expect(properties(await session).timestamp).toBe(1_234)

      const prompted = readGlobalUntil(reader, (event) => event.payload.type === SessionEvent.Prompted.type)
      await AppRuntime.runPromise(
        EventV2.Service.use((events) =>
          events.publish(SessionEvent.Prompted, {
            sessionID,
            timestamp,
            prompt: { text: "hello", files: [], agents: [], references: [] },
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      expect(properties(await prompted)).toMatchObject({ timestamp: 1_234, prompt: { text: "hello" } })
    } finally {
      await reader.cancel()
    }
  })
  // kilocode_change end
})
