import { describe, expect, test } from "bun:test"
import { streamAgentEvents } from "@/kilocode/cloud/websocket-stream"

function mockWebSocket(
  events: ReadonlyArray<
    { type: "message"; data: string | ArrayBuffer } | { type: "error" } | { type: "close"; code?: number }
  >,
  options?: { onClose?: (code?: number) => void; triggerOnCloseOnClose?: boolean },
) {
  return class MockWebSocket {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null

    constructor(_url: string) {
      queueMicrotask(() => {
        for (const event of events) {
          if (event.type === "message") {
            this.onmessage?.(new MessageEvent("message", { data: event.data }))
          } else if (event.type === "error") {
            this.onerror?.()
            return
          } else if (event.type === "close") {
            this.onclose?.({ code: event.code ?? 1000 } as CloseEvent)
            return
          }
        }
      })
    }

    close(code?: number) {
      options?.onClose?.(code)
      if (options?.triggerOnCloseOnClose) {
        queueMicrotask(() => {
          this.onclose?.({ code: code ?? 1000 } as CloseEvent)
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
      origin: "https://agent.example",
      writeLine: () => {},
      WebSocket: Tracked as unknown as typeof WebSocket,
    })

    expect(connectUrl).toEqual(["wss://agent.example/stream?ticket=tok"])
  })

  test("rejects an absolute stream URL on another origin", async () => {
    const Socket = mockWebSocket([{ type: "close" }])

    await expect(
      streamAgentEvents({
        streamUrl: "wss://other.example/stream?ticket=tok",
        origin: "https://agent.example",
        writeLine: () => {},
        WebSocket: Socket as unknown as typeof WebSocket,
      }),
    ).rejects.toThrow("Invalid stream URL origin")
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

  test("rejects when the WebSocket closes abnormally", async () => {
    const Socket = mockWebSocket([{ type: "close", code: 1011 }])

    await expect(
      streamAgentEvents({
        streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
        origin: "https://agent.example",
        writeLine: () => {},
        WebSocket: Socket as unknown as typeof WebSocket,
      }),
    ).rejects.toThrow("WebSocket stream closed unexpectedly (1011)")
  })

  test("rejects when the WebSocket stream stalls", async () => {
    const Socket = mockWebSocket([])

    await expect(
      streamAgentEvents({
        streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
        origin: "https://agent.example",
        writeLine: () => {},
        WebSocket: Socket as unknown as typeof WebSocket,
        timeoutMs: 1,
      }),
    ).rejects.toThrow("WebSocket stream timed out")
  })

  test("resolves 3 seconds after receiving a complete event", async () => {
    const lines: string[] = []
    const codes: Array<number | undefined> = []
    const Socket = mockWebSocket(
      [
        { type: "message", data: '{"event":"running"}' },
        { type: "message", data: '{"streamEventType":"complete","data":{"exitCode":0}}' },
      ],
      { onClose: (code) => codes.push(code), triggerOnCloseOnClose: true },
    )

    const start = Date.now()
    await streamAgentEvents({
      streamUrl: "/stream?cloudAgentSessionId=agent_123&ticket=tok",
      origin: "https://agent.example",
      writeLine: (line) => lines.push(line),
      WebSocket: Socket as unknown as typeof WebSocket,
    })

    expect(Date.now() - start).toBeGreaterThanOrEqual(3000)
    expect(codes).toEqual([1000])
    expect(lines).toEqual(['{"event":"running"}', '{"streamEventType":"complete","data":{"exitCode":0}}'])
  }, 10_000)
})
