import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { SdkSSEAdapter } from "../../src/services/cli-backend/sdk-sse-adapter"

type Opts = {
  onSseError?: (error: unknown) => void
  signal?: AbortSignal
}

type Stream = AsyncGenerator<unknown, void, unknown>

function client(open: (opts: Opts) => Stream): KiloClient {
  return {
    global: {
      event: async (opts: Opts) => ({ stream: open(opts) }),
    },
  } as unknown as KiloClient
}

function event() {
  return {
    directory: "/repo",
    payload: {
      id: "evt_connected",
      type: "server.connected",
      properties: {},
    },
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function aborted(signal?: AbortSignal) {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
}

describe("SdkSSEAdapter", () => {
  it("reports connected only after the first SSE event arrives", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const adapter = new SdkSSEAdapter(
      client(async function* (opts) {
        await gate
        yield event()
        await aborted(opts.signal)
      }),
    )
    const states: string[] = []
    const connected = new Promise<void>((resolve) => {
      adapter.onStateChange((state) => {
        states.push(state)
        if (state === "connected") resolve()
      })
    })

    adapter.connect()
    await wait(10)

    expect(states).toEqual(["connecting"])

    release()
    await connected

    expect(states).toEqual(["connecting", "connected"])
    adapter.disconnect()
  })

  it("backs off reconnects when an SSE fetch fails before opening", async () => {
    const timer = globalThis.setTimeout
    const delays: number[] = []
    let count = 0
    let finish = () => {}
    const reached = new Promise<void>((resolve) => {
      finish = resolve
    })
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number" && timeout <= 5_000) {
        delays.push(timeout)
        return timer(handler, 0, ...args)
      }
      return timer(handler, timeout, ...args)
    }) as typeof setTimeout

    const failing = new SdkSSEAdapter(
      client((opts) => {
        count += 1
        if (count === 3) finish()
        return (async function* () {
          opts.onSseError?.(new TypeError("fetch failed"))
        })()
      }),
    )

    try {
      failing.connect()
      await reached
      failing.disconnect()

      expect(delays.slice(0, 2)).toEqual([250, 500])
    } finally {
      failing.disconnect()
      globalThis.setTimeout = timer
    }
  })
})

describe("KiloConnectionService SSE startup", () => {
  it("waits through an initial SSE fetch failure until the stream opens", async () => {
    const original = globalThis.fetch
    const chunk = new TextEncoder().encode(
      'data: {"payload":{"id":"evt_connected","type":"server.connected","properties":{}}}\n\n',
    )
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) throw new TypeError("fetch failed")
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk)
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      )
    }) as typeof fetch

    const service = new KiloConnectionService({} as any)
    ;(service as any).serverManager.getServer = async () => ({ port: 52512, password: "secret", process: {} })

    try {
      await expect(service.connect("/tmp/workspace")).resolves.toBeUndefined()
      expect(calls).toBe(2)
      expect(service.getConnectionState()).toBe("connected")
    } finally {
      service.dispose()
      globalThis.fetch = original
    }
  })
})
