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

class FakeClock {
  now = 0
  private timers: { id: number; fireAt: number; fn: () => void; interval?: number }[] = []
  private nextId = 1

  setTimeout(fn: () => void, ms = 0) {
    const id = this.nextId++
    this.timers.push({ id, fireAt: this.now + ms, fn })
    this.timers.sort((a, b) => a.fireAt - b.fireAt || a.id - b.id)
    return id
  }

  clearTimeout(id: unknown) {
    this.timers = this.timers.filter((t) => t.id !== id)
  }

  setInterval(fn: () => void, ms = 0) {
    const id = this.nextId++
    this.timers.push({ id, fireAt: this.now + ms, fn, interval: ms })
    this.timers.sort((a, b) => a.fireAt - b.fireAt || a.id - b.id)
    return id
  }

  clearInterval(id: unknown) {
    this.timers = this.timers.filter((t) => t.id !== id)
  }

  advance(ms: number) {
    const end = this.now + ms
    while (true) {
      const due = this.timers.filter((t) => t.fireAt <= end)
      if (due.length === 0) {
        this.now = end
        return
      }
      const next = due[0]
      this.now = next.fireAt
      this.timers = this.timers.filter((t) => t.id !== next.id)
      if (next.interval !== undefined) {
        next.fireAt = this.now + next.interval
        this.timers.push(next)
        this.timers.sort((a, b) => a.fireAt - b.fireAt || a.id - b.id)
      }
      next.fn()
    }
  }
}

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  static reset() {
    this.instances = []
  }

  readonly sent: string[] = []
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(message: string) {
    this.sent.push(message)
  }

  close(code = 1000, reason = "closed") {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  open() {
    if (this.readyState !== FakeWebSocket.CONNECTING) return
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  disconnect(code = 1000, reason = "closed") {
    this.close(code, reason)
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

async function flush() {
  // Flush a few microtask ticks to let async getToken / onopen chains settle.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
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

    FakeWebSocket.reset()
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
      const first = FakeWebSocket.instances[0]
      expect(first).toBeDefined()
      first?.open()
      first?.disconnect()

      await until(() => FakeWebSocket.instances.length >= 2)
      const second = FakeWebSocket.instances[1]
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

  // -------------------------------------------------------------------------
  // Deterministic fake-clock tests (AC2: bounded token acquisition)
  // -------------------------------------------------------------------------

  async function withFakeWebSocket<T>(fn: (clock: FakeClock) => T): Promise<T> {
    const OriginalWebSocket = globalThis.WebSocket
    FakeWebSocket.reset()
    Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true, writable: true })
    try {
      const clock = new FakeClock()
      return await fn(clock)
    } finally {
      Object.defineProperty(globalThis, "WebSocket", { value: OriginalWebSocket, configurable: true, writable: true })
    }
  }

  test("AC2a: getToken() rejection schedules a bounded retry and later succeeds", async () => {
    await withFakeWebSocket(async (clock) => {
      let attempt = 0
      const getToken = async () => {
        attempt++
        if (attempt === 1) throw new Error("no token")
        return "tok"
      }

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken,
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        tokenTimeout: 1000,
      })

      // First token attempt fails immediately.
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(1)
      expect(FakeWebSocket.instances.length).toBe(0)

      // Retry fires at the initial backoff (1000ms).
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(2)
      expect(FakeWebSocket.instances.length).toBe(1)

      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)
    })
  })

  test("AC2b: getToken() that never settles triggers a bounded retry and later succeeds", async () => {
    await withFakeWebSocket(async (clock) => {
      let attempt = 0
      const getToken = async () => {
        attempt++
        if (attempt === 1) return new Promise<string | undefined>(() => {}) // never resolves
        return "tok"
      }

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken,
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        tokenTimeout: 1000,
      })

      // First token attempt times out.
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(1)
      expect(FakeWebSocket.instances.length).toBe(0)

      // Retry fires after backoff.
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(2)
      expect(FakeWebSocket.instances.length).toBe(1)

      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)
    })
  })

  test("AC2c: getToken() resolving undefined schedules a bounded retry and later succeeds", async () => {
    await withFakeWebSocket(async (clock) => {
      let attempt = 0
      const getToken = async () => {
        attempt++
        if (attempt === 1) return undefined
        return "tok"
      }

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken,
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        tokenTimeout: 1000,
      })

      // First token attempt resolves to undefined before the deadline.
      await flush()
      expect(attempt).toBe(1)
      expect(FakeWebSocket.instances.length).toBe(0)

      // The undefined result schedules a retry at the initial backoff.
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(2)
      expect(FakeWebSocket.instances.length).toBe(1)

      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC3: connection-attempt deadline with a single fenced retry owner
  // -------------------------------------------------------------------------

  test("AC3a: a socket stuck in CONNECTING is replaced by exactly one new attempt", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        connectTimeout: 1000,
      })

      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)

      // Connect deadline fires, scheduling a retry.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1) // old socket not yet replaced

      // Retry fires after backoff; exactly one new socket is created.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)

      // No further attempts appear.
      clock.advance(60_000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)
    })
  })

  test("AC3b: synchronous WebSocket constructor throw schedules exactly one retry", async () => {
    await withFakeWebSocket(async (clock) => {
      let attempts = 0
      class ThrowingWebSocket {
        static readonly OPEN = 1
        constructor() {
          attempts++
          throw new Error("constructor failed")
        }
      }
      const OriginalWebSocket = globalThis.WebSocket
      Object.defineProperty(globalThis, "WebSocket", { value: ThrowingWebSocket, configurable: true, writable: true })

      try {
        conn = RemoteWS.connect({
          url: "ws://example.test",
          getToken: async () => "tok",
          getSessions: async () => ({ sessions: [] }),
          log: nolog(),
          heartbeat: 60_000,
          timers: clock,
          now: () => clock.now,
        timeout: 300_000,
          connectTimeout: 1000,
        })

        await flush()
        expect(attempts).toBe(1)

        // Retry fires after backoff. The connect deadline (also at 1000ms) observes
        // the generation is already settled and does not schedule a second retry.
        clock.advance(1000)
        await flush()
        expect(attempts).toBe(2)
      } finally {
        Object.defineProperty(globalThis, "WebSocket", { value: OriginalWebSocket, configurable: true, writable: true })
      }
    })
  })

  test("AC3c: connect deadline only schedules exactly one retry when onclose arrives late", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        connectTimeout: 1000,
      })

      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)

      // Connect deadline fires for the first generation, closing the socket and scheduling a retry.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)

      // Retry fires after backoff; exactly one new socket is created.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)

      // Open the replacement socket and confirm the connection is live.
      const second = FakeWebSocket.instances[1]
      second.open()
      expect(conn.connected).toBe(true)

      // No further sockets are created.
      clock.advance(60_000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)
      expect(conn.connected).toBe(true)
    })
  })

  test("AC3d: connect deadline is cleared after a successful open", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        connectTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)

      // Advance well past connectTimeout; no deadline-driven reconnect should occur.
      clock.advance(60_000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)
      expect(conn.connected).toBe(true)
    })
  })

  test("AC3d: connect deadline is cleared after onclose", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        connectTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)

      socket.disconnect()
      await flush()
      expect(conn.connected).toBe(false)

      // Reconnect happens at the backoff time (1000ms), not at the connectTimeout.
      clock.advance(999)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)

      clock.advance(1)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)

      // No deadline-driven reconnect after the reconnect.
      clock.advance(60_000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)
    })
  })

  test("AC3d/e: connect deadline is cleared and no reconnect after Connection.close()", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        connectTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)

      conn.close()
      expect(conn.connected).toBe(false)

      // Advance past connectTimeout and backoff; no new attempts.
      clock.advance(60_000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC5: regression guard for permanent close codes and backoff reset
  //
  // Existing coverage:
  // - Initial backoff retry: "reconnects with backoff after server close".
  // - 4401 permanent stop: "stops reconnecting on 4401".
  // - Stale-generation fencing: "ignores callbacks from a stale WebSocket generation".
  // - close() no-reconnect: "close() prevents further reconnection and stops heartbeat".
  // - Activity timeout: "force-reconnects on activity timeout" / "resets activity timer...".
  // Missing and added below:
  // - 4403 and 4409 permanent close (no reconnect, onClose fired).
  // - Backoff resets to the initial value after a successful onopen.
  // -------------------------------------------------------------------------

  test("AC5: 4403 and 4409 are permanent close codes with no reconnect", async () => {
    await withFakeWebSocket(async (clock) => {
      for (const code of [4403, 4409]) {
        conn?.close()
        const codes: number[] = []
        FakeWebSocket.reset()

        conn = RemoteWS.connect({
          url: "ws://example.test",
          getToken: async () => "tok",
          getSessions: async () => ({ sessions: [] }),
          log: nolog(),
          heartbeat: 60_000,
          timers: clock,
          now: () => clock.now,
        timeout: 300_000,
          onClose: (c) => codes.push(c),
        })

        await flush()
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.disconnect(code, "permanent")

        await flush()
        expect(codes).toEqual([code])
        expect(conn.connected).toBe(false)

        // Advance far past any backoff; no reconnect.
        clock.advance(120_000)
        await flush()
        expect(FakeWebSocket.instances.length).toBe(1)
      }
    })
  })

  test("AC5: backoff resets to the initial value after a successful open", async () => {
    await withFakeWebSocket(async (clock) => {
      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions: async () => ({ sessions: [] }),
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
      })

      await flush()
      const first = FakeWebSocket.instances[0]
      first.open()

      // First transient close. schedule() uses 1000ms, then doubles to 2000ms.
      first.disconnect(1000, "first")
      await flush()

      // Reconnect at 1000ms.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)
      const second = FakeWebSocket.instances[1]
      second.open()

      // Second transient close. Because onopen reset backoff to 1000ms, the next
      // reconnect should be at 1000ms, not 2000ms.
      second.disconnect(1001, "second")
      await flush()

      clock.advance(999)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)

      clock.advance(1)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(3)
    })
  })
})
