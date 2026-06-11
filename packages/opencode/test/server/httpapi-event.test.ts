import { afterEach, describe, expect, test } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2" // kilocode_change
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { Event as ServerEvent } from "../../src/server/event"
import { withTimeout } from "../../src/util/timeout" // kilocode_change
import * as Log from "@opencode-ai/core/util/log"
import { Schema } from "effect"
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
      await Instance.restore(ctx, () => Bus.publish(ServerEvent.Connected, {}, { id }))

      expect(await next).toMatchObject({ id, type: "server.connected", properties: {} })
    } finally {
      await reader.cancel()
    }
  })

  // kilocode_change start
  test("delivers instance bus events through Server.listen", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const controller = new AbortController()
      const sdk = createKiloClient({ baseUrl: listener.url.toString(), directory: tmp.path })
      const events = await sdk.event.subscribe(undefined, { signal: controller.signal })
      try {
        const connected = await withTimeout(events.stream.next(), 5_000, "timed out waiting for initial event")
        expect(connected.value).toMatchObject({ type: "server.connected", properties: {} })

        const id = Bus.createID()
        const next = withTimeout(
          (async () => {
            while (true) {
              const event = await events.stream.next()
              if (event.done) throw new Error("event stream closed")
              if (event.value.id === id) return event.value
            }
          })(),
          5_000,
          "timed out waiting for published event",
        )
        const ctx = await reloadTestInstance({ directory: tmp.path })
        await Instance.restore(ctx, () => Bus.publish(ServerEvent.Connected, {}, { id }))

        expect(await next).toMatchObject({ id, type: "server.connected", properties: {} })
      } finally {
        controller.abort()
        await events.stream.return?.(undefined)
      }
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out cleaning up listener")
    }
  })
  // kilocode_change end
})
