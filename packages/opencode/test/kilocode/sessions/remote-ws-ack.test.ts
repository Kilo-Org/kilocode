import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test"
import type { RemoteWS } from "@/kilo-sessions/remote-ws"

// --- Mocks must be installed before importing the module under test. ---

// Capture messages the SUT sends to the (mocked) WebSocket.
let sentMessages: string[] = []
let sentMessagesWithAck: ((msg: string) => void) | undefined
let ws: {
  send: (data: string) => void
  close: () => void
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
} | undefined

function clearWs() {
  sentMessages = []
  sentMessagesWithAck = undefined
  ws = undefined
}

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  constructor(_url: string) {
    ws = this
  }
  send(data: string) {
    sentMessages.push(data)
    sentMessagesWithAck?.(data)
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: "test" })
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

describe("RemoteWS acknowledged heartbeat", () => {
  let originalSetInterval: typeof setInterval
  let originalClearInterval: typeof clearInterval
  let originalSetTimeout: typeof setTimeout
  let originalWebSocket: unknown
  let realRemoteWS: typeof import("@/kilo-sessions/remote-ws").RemoteWS | undefined
  let conn: RemoteWS.Connection | undefined

  beforeAll(() => {
    originalSetInterval = globalThis.setInterval
    originalClearInterval = globalThis.clearInterval
    originalSetTimeout = globalThis.setTimeout
    originalWebSocket = (globalThis as unknown as { WebSocket?: unknown }).WebSocket
    // Install the mock WebSocket and disable real timers — we drive state manually.
    ;(globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
    globalThis.setInterval = (() => 0) as unknown as typeof setInterval
    globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval
  })

  afterAll(() => {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    globalThis.setTimeout = originalSetTimeout
    ;(globalThis as unknown as { WebSocket?: unknown }).WebSocket = originalWebSocket
  })

  afterEach(() => {
    // The tests in this file close the mocked WebSocket directly to simulate
    // network events. That triggers the connection's reconnect logic, so we must
    // close the Connection itself to cancel any pending timers before the
    // next test (or test file) installs a different WebSocket mock.
    conn?.close()
    conn = undefined
  })

  async function connect() {
    clearWs()
    if (!realRemoteWS) {
      realRemoteWS = (await import("@/kilo-sessions/remote-ws")).RemoteWS
    }
    conn = realRemoteWS.connect({
      url: "ws://test",
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: { info: () => {}, error: () => {}, warn: () => {} },
    })
    // Wait for the async `open()` to create the WebSocket.
    for (let i = 0; i < 20 && !ws; i++) await flush()
    if (!ws) throw new Error("WebSocket was not created in time")
    // Drive the socket open.
    ws.readyState = FakeWebSocket.OPEN
    ws.onopen?.()
    return { conn }
  }

  test("passive heartbeat sends a heartbeat and resolves on unsequenced ack", async () => {
    const { conn } = await connect()
    // Drive the passive heartbeat path.
    const beat = conn.heartbeat()
    // WS receives the heartbeat; relay replies with an unsequenced ack.
    ws!.onmessage!({ data: JSON.stringify({ type: "heartbeat_ack" }) })
    await beat
  })

  test("acknowledged heartbeat sends a sequenced heartbeat and resolves on matching ack", async () => {
    const { conn } = await connect()
    const beat = conn.heartbeatAcknowledged()
    // Let the async withContext body complete and call send().
    await flush()
    expect(sentMessages.length).toBe(1)
    const payload = JSON.parse(sentMessages[0]!)
    expect(payload.sequence).toBe(1)
    // Ack with the matching sequence resolves the promise.
    ws!.onmessage!({ data: JSON.stringify({ type: "heartbeat_ack", sequence: 1 }) })
    await beat
  })

  test("acknowledged heartbeat rejects on disconnect before ack", async () => {
    const { conn } = await connect()
    const beat = conn.heartbeatAcknowledged()
    // Simulate disconnect before ack arrives.
    ws!.readyState = FakeWebSocket.CLOSED
    ws!.onclose!({ code: 1006, reason: "lost" })
    await expect(beat).rejects.toThrow()
  })

  test("acknowledged heartbeat rejects on timeout", async () => {
    const { conn } = await connect()
    // Override setTimeout for the ack timeout to fire immediately.
    globalThis.setTimeout = ((handler: () => void, _ms?: number) => {
      queueMicrotask(handler)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    try {
      const beat = conn.heartbeatAcknowledged()
      await expect(beat).rejects.toThrow(/timeout/i)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test("an unsequenced ack does not resolve an acknowledged heartbeat", async () => {
    const { conn } = await connect()
    const beat = conn.heartbeatAcknowledged()
    // Send a legacy unsequenced ack — the awaited heartbeat must NOT resolve.
    ws!.onmessage!({ data: JSON.stringify({ type: "heartbeat_ack" }) })
    // Let microtasks drain; if the promise resolved, we'd see it.
    await flush()
    let resolved = false
    beat.then(
      () => {
        resolved = true
      },
      () => {}
    )
    await flush()
    expect(resolved).toBe(false)
    // Clean up: send the matching ack so the pending counter is cleared.
    ws!.onmessage!({ data: JSON.stringify({ type: "heartbeat_ack", sequence: 1 }) })
    await beat
  })

  test("connectionId is exposed on the Connection interface", async () => {
    const { conn } = await connect()
    expect(typeof conn.connectionId).toBe("string")
    expect(conn.connectionId.length).toBeGreaterThan(0)
  })
})
