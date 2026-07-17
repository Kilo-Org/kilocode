import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { SdkSSEAdapter, type SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"

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

function sync() {
  return {
    directory: "/repo",
    payload: {
      type: "sync",
      id: "evt_part",
      syncEvent: {
        type: "message.part.removed.1",
        id: "evt_part",
        seq: 3,
        aggregateID: "sessionID",
        data: { sessionID: "session", messageID: "message", partID: "part" },
      },
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
  it("normalizes nested sync envelopes at the SSE boundary", async () => {
    const adapter = new SdkSSEAdapter(
      client(async function* (opts) {
        yield sync()
        await aborted(opts.signal)
      }),
    )
    const received = new Promise<SSEPayload>((resolve) => adapter.onEvent(resolve))

    adapter.connect()

    expect(await received).toEqual({
      type: "sync",
      name: "message.part.removed.1",
      id: "evt_part",
      seq: 3,
      aggregateID: "sessionID",
      data: { sessionID: "session", messageID: "message", partID: "part" },
    })
    adapter.disconnect()
  })

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

  it("does not log each streamed event", async () => {
    const log = console.log
    const logs: unknown[][] = []
    console.log = (...args: unknown[]) => logs.push(args)
    let count = 0
    let finish = () => {}
    const received = new Promise<void>((resolve) => {
      finish = resolve
    })
    const adapter = new SdkSSEAdapter(
      client(async function* (opts) {
        for (let i = 0; i < 100; i++) yield event()
        await aborted(opts.signal)
      }),
    )
    adapter.onEvent(() => {
      count += 1
      if (count === 100) finish()
    })

    try {
      adapter.connect()
      await received
      expect(logs.some((args) => args.some((value) => String(value).includes("Event:")))).toBe(false)
    } finally {
      adapter.disconnect()
      console.log = log
    }
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

describe("KiloConnectionService backend crash", () => {
  it("invalidates the stale SDK client and reports a retryable error", () => {
    const service = new KiloConnectionService({} as any)
    const states: Array<{ state: string; error?: string }> = []
    ;(service as any).client = {}
    ;(service as any).config = { baseUrl: "http://127.0.0.1:52512", password: "secret" }
    ;(service as any).info = { port: 52512 }
    ;(service as any).state = "connected"
    service.onStateChange((state, error) => states.push({ state, error: error?.message }))
    ;(service as any).handleServerExit(9)

    expect(service.getConnectionState()).toBe("error")
    expect(service.getConnectionError()?.message).toContain("CLI background process exited with code 9")
    expect(service.getServerConfig()).toBeNull()
    expect(service.getServerInfo()).toBeNull()
    expect(() => service.getClient()).toThrow("Not connected")
    expect(states).toEqual([
      { state: "error", error: "CLI background process exited with code 9. Retry to reconnect." },
    ])
    service.dispose()
  })

  it("does not expose an SDK client while a replacement server is connecting", () => {
    const service = new KiloConnectionService({} as any)
    ;(service as any).client = {}
    ;(service as any).state = "connecting"

    expect(() => service.getClient()).toThrow("Not connected")
    service.dispose()
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
