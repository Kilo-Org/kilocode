import { describe, expect, test } from "bun:test"
import { streamAgentEvents } from "@/kilocode/cloud/websocket-stream"

function mockWebSocket(
  events: ReadonlyArray<
    { type: "message"; data: string | ArrayBuffer } | { type: "error" } | { type: "close" }
  >,
  options?: { onClose?: () => void; triggerOnCloseOnClose?: boolean },
) {
  return class MockWebSocket {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null

    constructor(_url: string) {
      queueMicrotask(() => {
        for (const event of events) {
          if (event.type === "message") {
            this.onmessage?.(new MessageEvent("message", { data: event.data }))
          } else if (event.type === "error") {
            this.onerror?.()
            return
          } else if (event.type === "close") {
            this.onclose?.()
            return
          }
        }
      })
    }

    close() {
      options?.onClose?.()
      if (options?.triggerOnCloseOnClose) {
        queueMicrotask(() => {
          this.onclose?.()
        })
      }
    }
  }
}

describe("streamAgentEvents", () => {
  test("writes WebSocket text messages as lines", async () => {
    const lines: string[] = []
    const Socket = mockWebSocket([
      { type: "message", data: '{"event":"one"}' },
      { type: "message", data: '{"event":"two"}' },
      { type: "close" },
    ])

    await streamAgentEvents({
      streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
      origin: "https://agent.example",
      writeLine: (line) => lines.push(line),
      WebSocket: Socket as unknown as typeof WebSocket,
    })

    expect(lines).toEqual(['{"event":"one"}', '{"event":"two"}'])
  })

  test("resolves an absolute wss URL", async () => {
    const Socket = mockWebSocket([{ type: "close" }])
    const connectUrl: string[] = []

    class Tracked extends Socket {
      constructor(url: string) {
        super(url)
        connectUrl.push(url)
      }
    }

    await streamAgentEvents({
      streamUrl: "wss://agent.example/stream?ticket=tok",
      origin: "https://other.example",
      writeLine: () => {},
      WebSocket: Tracked as unknown as typeof WebSocket,
    })

    expect(connectUrl).toEqual(["wss://agent.example/stream?ticket=tok"])
  })

  test("converts a relative URL to an absolute wss URL", async () => {
    const Socket = mockWebSocket([{ type: "close" }])
    const connectUrl: string[] = []

    class Tracked extends Socket {
      constructor(url: string) {
        super(url)
        connectUrl.push(url)
      }
    }

    await streamAgentEvents({
      streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
      origin: "https://agent.example",
      writeLine: () => {},
      WebSocket: Tracked as unknown as typeof WebSocket,
    })

    expect(connectUrl).toEqual(["wss://agent.example/stream?cloudAgentSessionId=agent_123&ticket=tok"])
  })

  test("rejects when the WebSocket errors", async () => {
    const Socket = mockWebSocket([{ type: "error" }])

    await expect(
      streamAgentEvents({
        streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
        origin: "https://agent.example",
        writeLine: () => {},
        WebSocket: Socket as unknown as typeof WebSocket,
      }),
    ).rejects.toThrow("WebSocket stream connection failed")
  })

  test("resolves 3 seconds after receiving a complete event", async () => {
    const lines: string[] = []
    let closed = 0
    const Socket = mockWebSocket(
      [
        { type: "message", data: '{"event":"running"}' },
        { type: "message", data: '{"streamEventType":"complete","data":{"exitCode":0}}' },
      ],
      { onClose: () => closed++, triggerOnCloseOnClose: true },
    )

    const start = Date.now()
    await streamAgentEvents({
      streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
      origin: "https://agent.example",
      writeLine: (line) => lines.push(line),
      WebSocket: Socket as unknown as typeof WebSocket,
    })

    expect(Date.now() - start).toBeGreaterThanOrEqual(3000)
    expect(closed).toBe(1)
    expect(lines).toEqual(['{"event":"running"}', '{"streamEventType":"complete","data":{"exitCode":0}}'])
  }, 10_000)
})
