import { afterEach, describe, expect, test } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { Bus } from "../../../src/bus"
import { Instance } from "../../../src/project/instance"
import { Server } from "../../../src/server/server"
import { Event as ServerEvent } from "../../../src/server/event"
import { withTimeout } from "../../../src/util/timeout"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("Kilo event HttpApi", () => {
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
})
