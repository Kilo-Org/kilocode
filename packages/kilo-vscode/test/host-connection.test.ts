import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import { createRoot } from "solid-js"
import { createHostConnection } from "../webview-ui/src/v2/host-connection"
import type { ToHost } from "../src/protocol"

function fakeApi() {
  let subscribes = 0
  const api = {
    event: {
      subscribe({ signal }: { signal: AbortSignal }) {
        subscribes++
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "server.connected", id: "evt_0", created: 0, data: {} }
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
          },
        }
      },
    },
  } as unknown as OpenCodeClient
  return { api, subscribes: () => subscribes }
}

describe("createHostConnection", () => {
  test("waits for host serverStatus before subscribing when KILO_SERVER_READY is false", async () => {
    const prev = globalThis.window
    Object.assign(globalThis, { window: { KILO_SERVER_READY: false } })
    try {
      const { api, subscribes } = fakeApi()
      const posted: ToHost[] = []
      const dispose = createRoot((end) => {
        const host = createHostConnection({
          api,
          onEvent: () => undefined,
          post: (msg) => posted.push(msg),
        })
        expect(subscribes()).toBe(0)
        expect(host.connection.status()).toBe("connecting")
        return { end, host }
      })
      await Promise.resolve()
      expect(posted).toEqual([{ type: "requestServerStatus" }])
      expect(subscribes()).toBe(0)

      expect(dispose.host.receive({ type: "serverStatus", status: "ready" })).toBe(true)
      expect(subscribes()).toBe(1)
      dispose.end()
    } finally {
      Object.assign(globalThis, { window: prev })
    }
  })

  test("connects immediately when KILO_SERVER_READY is true", () => {
    const prev = globalThis.window
    Object.assign(globalThis, { window: { KILO_SERVER_READY: true } })
    try {
      const { api, subscribes } = fakeApi()
      const posted: ToHost[] = []
      const end = createRoot((dispose) => {
        createHostConnection({
          api,
          onEvent: () => undefined,
          post: (msg) => posted.push(msg),
        })
        return dispose
      })
      expect(subscribes()).toBe(1)
      expect(posted).toEqual([])
      end()
    } finally {
      Object.assign(globalThis, { window: prev })
    }
  })
})
