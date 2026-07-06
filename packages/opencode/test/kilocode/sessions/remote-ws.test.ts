import { afterEach, describe, expect, test } from "bun:test"
import { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import type { ServerWebSocket } from "bun"

function nolog() {
  return {
    info: () => {},
    error: () => {},
    warn: () => {},
  }
}

function capture() {
  const calls: unknown[][] = []
  return {
    calls,
    log: {
      info: (...args: unknown[]) => calls.push(args),
      error: (...args: unknown[]) => calls.push(args),
      warn: (...args: unknown[]) => calls.push(args),
    },
  }
}

function createServer() {
  const messages: string[] = []
  const clients: ServerWebSocket<unknown>[] = []
  const urls: URL[] = []
  const pending: {
    connect: ((ws: ServerWebSocket<unknown>) => void)[]
    message: ((msg: string) => void)[]
  } = { connect: [], message: [] }

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      urls.push(new URL(req.url))
      const upgraded = server.upgrade(req)
      if (!upgraded) return new Response("Not found", { status: 404 })
      return undefined
    },
    websocket: {
      open(ws) {
        clients.push(ws)
        const cb = pending.connect.shift()
        cb?.(ws)
      },
      message(_ws, msg) {
        const str = String(msg)
        messages.push(str)
        const cb = pending.message.shift()
        cb?.(str)
      },
      close(ws) {
        const idx = clients.indexOf(ws)
        if (idx >= 0) clients.splice(idx, 1)
      },
    },
  })

  return {
    url: `ws://localhost:${server.port}`,
    messages,
    clients,
    urls,
    stop: () => server.stop(true),
    waitForConnect: () =>
      new Promise<ServerWebSocket<unknown>>((resolve) => {
        pending.connect.push(resolve)
      }),
    waitForMessage: () =>
      new Promise<string>((resolve) => {
        pending.message.push(resolve)
      }),
  }
}

async function until(predicate: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("condition never became true")
    await Bun.sleep(20)
  }
}

async function settled() {
  await Bun.sleep(20)
}

describe("RemoteWS", () => {
  let server: ReturnType<typeof createServer>
  let conn: RemoteWS.Connection | undefined

  afterEach(() => {
    conn?.close()
    conn = undefined
    server?.stop()
  })

  test("connects and sends heartbeat", async () => {
    server = createServer()
    const connecting = server.waitForConnect()
    const msg = server.waitForMessage()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [{ id: "s1", status: "active", title: "Test" }] }),
      log: nolog(),
      heartbeat: 100,
    })

    await connecting
    await settled()
    expect(conn.connected).toBe(true)

    const raw = await msg
    const parsed = JSON.parse(raw)
    expect(parsed.type).toBe("heartbeat")
    expect(parsed.sessions).toEqual([{ id: "s1", status: "active", title: "Test" }])
  })

  test("serializes concurrent heartbeat snapshots", async () => {
    server = createServer()
    const connecting = server.waitForConnect()
    const firstMessage = server.waitForMessage()
    const secondMessage = server.waitForMessage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    let active = 0
    let max = 0

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => {
        const call = ++calls
        active += 1
        max = Math.max(max, active)
        if (call === 1) await gate
        active -= 1
        return { sessions: [{ id: `s${call}`, status: "active" as const, title: `Session ${call}` }] }
      },
      log: nolog(),
      heartbeat: 60_000,
    })

    await connecting
    await settled()
    const first = conn.heartbeat()
    const second = conn.heartbeat()
    await Bun.sleep(10)
    expect(calls).toBe(1)

    release()
    await Promise.all([first, second])
    expect(max).toBe(1)
    expect(JSON.parse(await firstMessage).sessions[0].id).toBe("s1")
    expect(JSON.parse(await secondMessage).sessions[0].id).toBe("s2")
  })

  test("buffers when disconnected, flushes on reconnect", async () => {
    server = createServer()
    const connecting = server.waitForConnect()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
    })

    await connecting
    await settled()

    for (const ws of [...server.clients]) ws.close()
    await Bun.sleep(50)

    expect(conn.connected).toBe(false)

    conn.send({ type: "event", sessionId: "s1", event: "test", data: { a: 1 } })
    conn.send({ type: "event", sessionId: "s2", event: "test", data: { b: 2 } })

    const msg1 = server.waitForMessage()
    const msg2 = server.waitForMessage()
    await server.waitForConnect()
    await settled()

    const r1 = JSON.parse(await msg1)
    const r2 = JSON.parse(await msg2)
    expect(r1.sessionId).toBe("s1")
    expect(r2.sessionId).toBe("s2")
  })

  test("reconnects with backoff after server close", async () => {
    server = createServer()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
    })

    const ws1 = await server.waitForConnect()
    await settled()

    const reconnecting = server.waitForConnect()
    ws1.close()
    await Bun.sleep(50)

    expect(conn.connected).toBe(false)

    const ws2 = await reconnecting
    expect(ws2).toBeDefined()
    await settled()
    expect(conn.connected).toBe(true)
  })

  test("keeps a stable connection identity across reconnects", async () => {
    server = createServer()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
    })

    const first = await server.waitForConnect()
    await settled()
    const initial = server.urls[0]?.searchParams.get("connectionId")
    expect(initial).toBe(conn.connectionId)

    const reconnecting = server.waitForConnect()
    first.close()
    await reconnecting
    await settled()

    const replacement = server.urls[1]?.searchParams.get("connectionId")
    expect(replacement).toBe(initial)
    expect(replacement).toBe(conn.connectionId)
  })

  test("ignores callbacks from a stale WebSocket generation", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const sockets: FakeWebSocket[] = []
    const received: unknown[] = []

    class FakeWebSocket {
      static readonly OPEN = 1
      readonly sent: string[] = []
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: ((event: { code: number; reason: string }) => void) | null = null
      onerror: ((event: unknown) => void) | null = null

      constructor(readonly url: string) {
        sockets.push(this)
      }

      send(message: string) {
        this.sent.push(message)
      }

      close() {
        this.readyState = 3
      }

      open() {
        this.readyState = FakeWebSocket.OPEN
        this.onopen?.()
      }

      disconnect(code = 1000, reason = "closed") {
        this.readyState = 3
        this.onclose?.({ code, reason })
      }
    }

    Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true, writable: true })
    try {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        onMessage: (message) => received.push(message),
      })

      await settled()
      const first = sockets[0]
      expect(first).toBeDefined()
      first?.open()
      first?.disconnect()

      await until(() => sockets.length >= 2)
      const second = sockets[1]
      expect(second).toBeDefined()
      second?.open()

      first?.onmessage?.({ data: JSON.stringify({ type: "subscribe", sessionId: "stale" }) })
      first?.onclose?.({ code: 1000, reason: "late close" })
      conn.send({ type: "event", sessionId: "active", event: "test", data: {} })

      expect(received).toEqual([])
      expect(conn.connected).toBe(true)
      expect(second?.sent).toEqual([JSON.stringify({ type: "event", sessionId: "active", event: "test", data: {} })])

      conn.close()
      conn = undefined
    } finally {
      Object.defineProperty(globalThis, "WebSocket", { value: OriginalWebSocket, configurable: true, writable: true })
    }
  })

  test("stops reconnecting on 4401", async () => {
    server = createServer()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
    })

    const ws1 = await server.waitForConnect()
    await settled()

    ws1.close(4401, "unauthorized")

    await Bun.sleep(2000)

    expect(conn.connected).toBe(false)
    expect(server.clients.length).toBe(0)
  })

  test("onClose callback fires on permanent close", async () => {
    server = createServer()
    const codes: number[] = []

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
      onClose: (code) => codes.push(code),
    })

    const ws1 = await server.waitForConnect()
    await settled()

    ws1.close(4401, "unauthorized")
    await Bun.sleep(100)

    expect(codes).toEqual([4401])
    expect(conn.connected).toBe(false)
  })

  test("incoming message delivered to onMessage", async () => {
    server = createServer()
    const received: unknown[] = []
    const cap = capture()
    const secret = "user secret prompt"

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: cap.log,
      heartbeat: 60_000,
      onMessage: (msg) => received.push(msg),
    })

    const ws = await server.waitForConnect()
    await settled()

    ws.send(
      JSON.stringify({
        type: "command",
        id: "c1",
        command: "send_message",
        sessionId: "s1",
        data: { text: secret },
      }),
    )

    await Bun.sleep(50)
    expect(received.length).toBe(1)
    expect(received[0]).toEqual({
      type: "command",
      id: "c1",
      command: "send_message",
      sessionId: "s1",
      data: { text: secret },
    })

    const seen = JSON.stringify(cap.calls)
    expect(seen.includes(secret)).toBe(false)
    expect(cap.calls).toContainEqual(["remote-ws received", { bytes: expect.any(Number), type: "command", id: "c1" }])
  })

  test("close() prevents further reconnection and stops heartbeat", async () => {
    server = createServer()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [{ id: "s1", status: "active", title: "Test" }] }),
      log: nolog(),
      heartbeat: 100,
    })

    await server.waitForConnect()
    await settled()

    // Drain initial heartbeat message(s)
    server.messages.length = 0

    conn.close()
    conn = undefined

    // Wait long enough for heartbeat and reconnect if they were still running
    await Bun.sleep(500)

    // No new connections and no new heartbeat messages
    expect(server.clients.length).toBe(0)
    expect(server.messages.length).toBe(0)
  })

  test("force-reconnects on activity timeout", async () => {
    server = createServer()
    const ws1 = server.waitForConnect()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
      timeout: 200,
    })

    await ws1
    await settled()
    expect(conn.connected).toBe(true)

    // Don't send any server messages — timeout should fire
    const ws2 = server.waitForConnect()
    await Bun.sleep(450)

    // Should have reconnected
    await ws2
    await settled()
    expect(conn.connected).toBe(true)
  })

  test("resets activity timer on incoming messages", async () => {
    server = createServer()
    const ws1p = server.waitForConnect()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
      timeout: 300,
    })

    const ws1 = await ws1p
    await settled()

    // Send server messages at 100ms intervals — each resets the timer
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(100)
      ws1.send(JSON.stringify({ type: "subscribe", sessionId: `s${i}` }))
    }

    await settled()
    // Connection should still be alive — activity kept resetting the timer
    expect(conn.connected).toBe(true)
    expect(server.clients.length).toBe(1)
  })

  test("activity timeout uses custom timeout option", async () => {
    server = createServer()
    const ws1 = server.waitForConnect()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: async () => ({ sessions: [] }),
      log: nolog(),
      heartbeat: 60_000,
      timeout: 100,
    })

    await ws1
    await settled()

    // With 100ms timeout, should reconnect faster than default 30s
    const ws2 = server.waitForConnect()
    await Bun.sleep(250)

    await ws2
    await settled()
    expect(conn.connected).toBe(true)
  })
})
