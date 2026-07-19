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

async function flushLong(iterations = 10) {
  // Flush enough microtask ticks for a full gather cycle to settle:
  // .then handler on getSessions → .then handler on normalized → resolve inner
  // Promise → await resume in gatherOnce → await resume in while loop body →
  // .finally on runLoop's beating Promise.
  for (let i = 0; i < iterations; i++) await Promise.resolve()
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

  // Fire a heartbeat() and swallow its rejection (e.g. on close()) so the
  // discarded promise cannot become an unhandled rejection.
  function fireHeartbeat() {
    void conn?.heartbeat().catch(() => {})
  }

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
        tokenTimeout: 15_000,
      })

      // The rejected getToken settles before the token deadline.
      await flush()
      expect(attempt).toBe(1)
      expect(FakeWebSocket.instances.length).toBe(0)

      // Retry fires at the initial backoff (1000ms), well before tokenTimeout.
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

  test("AC3f: connect-attempt deadline close does not invoke onDisconnect; post-open transient close does", async () => {
    await withFakeWebSocket(async (clock) => {
      let disconnects = 0

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
        onDisconnect: () => disconnects++,
      })

      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)

      // Connect deadline fires, closing the socket before it opened.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)
      expect(disconnects).toBe(0)

      // Retry fires after backoff; a new socket is created.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)

      // Open the replacement socket and then close it transiently.
      const socket = FakeWebSocket.instances[1]
      socket.open()
      expect(conn.connected).toBe(true)

      socket.disconnect(1000, "transient")
      await flush()
      expect(disconnects).toBe(1)
      expect(conn.connected).toBe(false)
    })
  })

  test("AC3g: a token that resolves after the connect deadline fired does not assign a stale socket", async () => {
    await withFakeWebSocket(async (clock) => {
      let attempt = 0
      let lateResolve!: (v: string) => void
      const getToken = () => {
        attempt++
        if (attempt === 1) {
          return new Promise<string>((r) => {
            lateResolve = r
          })
        }
        return Promise.resolve("tok")
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
        connectTimeout: 1000,
        tokenTimeout: 15000,
      })

      // Gen1: getToken() is still pending; no socket has been constructed yet.
      await flush()
      expect(attempt).toBe(1)
      expect(FakeWebSocket.instances.length).toBe(0)

      // The connect deadline fires while getToken() is pending, settling gen1
      // and scheduling a retry. ws is still undefined at this point, so the
      // deadline's ws.close() is a no-op.
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(0)

      // Gen2 fires after the initial backoff (1000ms). Its getToken()
      // resolves immediately and a socket is constructed.
      clock.advance(1000)
      await flush()
      expect(attempt).toBe(2)
      expect(FakeWebSocket.instances.length).toBe(1)
      const gen2Socket = FakeWebSocket.instances[0]
      gen2Socket.open()
      expect(conn.connected).toBe(true)

      // Now gen1's late token resolves. The guarded continuation must
      // observe g.settled and return without constructing a stale socket
      // and without clobbering the live ws pointer.
      lateResolve("tok-late")
      await flush()
      expect(FakeWebSocket.instances.length).toBe(1)
      expect(conn.connected).toBe(true)
      expect(FakeWebSocket.instances[0]).toBe(gen2Socket)
      expect(gen2Socket.readyState).toBe(FakeWebSocket.OPEN)
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
  // - Pending heartbeat() waiters reject on permanent close.
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

  test("AC5b: pending heartbeat() rejects on permanent close codes 4403 and 4409", async () => {
    await withFakeWebSocket(async (clock) => {
      for (const code of [4403, 4409]) {
        conn?.close()
        const closed: Array<{ code: number; reason: string }> = []
        FakeWebSocket.reset()

        conn = RemoteWS.connect({
          url: "ws://example.test",
          getToken: async () => "tok",
          getSessions: () => new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {}),
          log: nolog(),
          heartbeat: 60_000,
          timers: clock,
          now: () => clock.now,
          timeout: 300_000,
          gatherTimeout: 1000,
          onClose: (c, r) => closed.push({ code: c, reason: r }),
        })

        await flush()
        const socket = FakeWebSocket.instances[0]
        socket.open()

        // Wedge the gather so heartbeat() stays pending.
        const promise = conn.heartbeat()
        let resolved = false
        let rejected = false
        let rejectionError: unknown
        void promise.then(
          () => {
            resolved = true
          },
          (err) => {
            rejected = true
            rejectionError = err
          },
        )
        clock.advance(1000)
        await flushLong()
        expect(socket.sent.length).toBe(1)
        expect(resolved).toBe(false)
        expect(rejected).toBe(false)

        // Permanent close: pending waiter must reject, and onClose fires.
        socket.disconnect(code, "permanent")
        await flush()
        expect(resolved).toBe(false)
        expect(rejected).toBe(true)
        expect(String(rejectionError)).toContain("remote-ws connection permanently closed")
        expect(closed).toEqual([{ code, reason: "permanent" }])
        expect(conn.connected).toBe(false)
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

  // -------------------------------------------------------------------------
  // AC4: bounded heartbeat gather with freshness-fenced attach (Path D fix)
  // -------------------------------------------------------------------------

  test("AC4a: never-settling gather sends a degraded heartbeat and keeps the connection live", async () => {
    await withFakeWebSocket(async (clock) => {
      const getSessions = () => new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {})

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()
      expect(conn.connected).toBe(true)

      const promise = conn.heartbeat()
      clock.advance(1000)
      await flushLong()

      // Degraded heartbeat was sent over the live socket (cold start → empty)
      expect(socket.sent.length).toBe(1)
      const parsed = JSON.parse(socket.sent[0])
      expect(parsed.type).toBe("heartbeat")
      expect(parsed.sessions).toEqual([])

      // Connection still live
      expect(conn.connected).toBe(true)

      // Waiter stays pending (degraded sends do not resolve attach)
      let resolved = false
      void promise.then(
        () => {
          resolved = true
        },
        () => {},
      )
      await flushLong()
      expect(resolved).toBe(false)
    })
  })

  test("AC4b: a gather that settles after its deadline is discarded", async () => {
    await withFakeWebSocket(async (clock) => {
      let lateResolve!: (v: { sessions: RemoteWS.SessionInfo[] }) => void
      const getSessions = () =>
        new Promise<{ sessions: RemoteWS.SessionInfo[] }>((r) => {
          lateResolve = r
        })

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Cycle 1: wedge, then time out → degraded send (cold start → empty)
      fireHeartbeat()
      clock.advance(1000)
      await flushLong()
      expect(socket.sent.length).toBe(1)
      expect(JSON.parse(socket.sent[0]).sessions).toEqual([])

      // Late settle: the original getSessions promise eventually resolves.
      // This must NOT cause any additional heartbeat to be sent — its result
      // is discarded because the cycle already abandoned it on timeout.
      lateResolve({
        sessions: [{ id: "late", status: "active", title: "Late" }] as RemoteWS.SessionInfo[],
      })
      await flushLong()

      // No further heartbeat sent; the last payload is still the degraded/last-good list
      expect(socket.sent.length).toBe(1)
      expect(JSON.parse(socket.sent[0]).sessions).toEqual([])
    })
  })

  test("AC4c: after a timed-out cycle, a later fresh-gather cycle sends fresh sessions", async () => {
    await withFakeWebSocket(async (clock) => {
      let mode: "wedge" | "fresh" = "wedge"
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () =>
        mode === "wedge"
          ? new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {})
          : Promise.resolve({ sessions: freshSessions })

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Cycle 1: wedge → degraded send
      fireHeartbeat()
      clock.advance(1000)
      await flushLong()
      expect(socket.sent.length).toBe(1)
      expect(JSON.parse(socket.sent[0]).sessions).toEqual([])

      // Cycle 2: switch to fresh, kick another cycle
      mode = "fresh"
      const promise2 = conn.heartbeat()
      void promise2.catch(() => {})
      await flushLong()
      expect(socket.sent.length).toBe(2)
      const payload2 = JSON.parse(socket.sent[1])
      expect(payload2.type).toBe("heartbeat")
      expect(payload2.sessions).toEqual(freshSessions)
      // The fresh cycle sent over a live socket → promise resolved
      await promise2
    })
  })

  test("AC4d: maxOutstandingGathers cap blocks calls while wedged; settling one allows recovery", async () => {
    await withFakeWebSocket(async (clock) => {
      let calls = 0
      let mode: "wedge" | "fresh" = "wedge"
      const wedgeResolvers: Array<(v: { sessions: RemoteWS.SessionInfo[] }) => void> = []
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () => {
        calls++
        if (mode === "wedge") {
          return new Promise<{ sessions: RemoteWS.SessionInfo[] }>((r) => {
            wedgeResolvers.push(r)
          })
        }
        return Promise.resolve({ sessions: freshSessions })
      }

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
        maxOutstandingGathers: 2,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Cycle 1: wedge → degraded. The wedge never settles, so its slot stays held.
      fireHeartbeat()
      clock.advance(1000)
      await flushLong()
      expect(calls).toBe(1)
      expect(JSON.parse(socket.sent[0]).sessions).toEqual([])

      // Cycle 2: wedge → degraded. Second wedge held, outstanding now at cap (2).
      fireHeartbeat()
      clock.advance(1000)
      await flushLong()
      expect(calls).toBe(2)
      expect(JSON.parse(socket.sent[1]).sessions).toEqual([])

      // Cycle 3: cap reached. getSessions MUST NOT be called again, but a
      // degraded heartbeat must still be sent (liveness is preserved).
      fireHeartbeat()
      clock.advance(1000)
      await flushLong()
      expect(calls).toBe(2)
      expect(socket.sent.length).toBe(3)
      expect(JSON.parse(socket.sent[2]).sessions).toEqual([])

      // Settle the first wedge → its slot is released, outstanding drops to 1.
      wedgeResolvers.shift()!({ sessions: freshSessions })
      // Let the .then release handler run (microtask).
      await flushLong()
      // Switch to fresh so the next gather resolves promptly.
      mode = "fresh"
      // Cycle 4: outstanding=1 < cap=2, getSessions IS called, resolves fresh.
      fireHeartbeat()
      await flushLong()
      expect(calls).toBe(3)
      expect(socket.sent.length).toBe(4)
      expect(JSON.parse(socket.sent[3]).sessions).toEqual(freshSessions)
    })
  })

  test("AC4f: promptly-rejecting getSessions → degraded, no slot consumed, recovers on resolve", async () => {
    await withFakeWebSocket(async (clock) => {
      let calls = 0
      let mode: "reject" | "fresh" = "reject"
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () => {
        calls++
        return mode === "reject"
          ? Promise.reject(new Error("gather failed"))
          : Promise.resolve({ sessions: freshSessions })
      }

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Cycle 1: reject → degraded (cold start → empty)
      fireHeartbeat()
      await flushLong()
      expect(calls).toBe(1)
      expect(JSON.parse(socket.sent[0]).sessions).toEqual([])

      // Cycle 2: reject again — no slot was held, so getSessions is called again immediately
      fireHeartbeat()
      await flushLong()
      expect(calls).toBe(2)
      expect(socket.sent.length).toBe(2)
      expect(JSON.parse(socket.sent[1]).sessions).toEqual([])

      // Switch to fresh → next cycle is fresh
      mode = "fresh"
      fireHeartbeat()
      await flushLong()
      expect(calls).toBe(3)
      expect(socket.sent.length).toBe(3)
      expect(JSON.parse(socket.sent[2]).sessions).toEqual(freshSessions)
    })
  })

  test("AC4g: synchronously-throwing getSessions releases slot and recovers", async () => {
    await withFakeWebSocket(async (clock) => {
      let calls = 0
      let mode: "throw" | "fresh" = "throw"
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () => {
        calls++
        if (mode === "throw") {
          throw new Error("gather sync throw")
        }
        return Promise.resolve({ sessions: freshSessions })
      }

      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => unhandled.push(reason)
      process.on("unhandledRejection", onUnhandled)

      try {
        conn = RemoteWS.connect({
          url: "ws://example.test",
          getToken: async () => "tok",
          getSessions,
          log: nolog(),
          heartbeat: 60_000,
          timers: clock,
          now: () => clock.now,
          timeout: 300_000,
          gatherTimeout: 1000,
          maxOutstandingGathers: 1,
        })

        await flush()
        const socket = FakeWebSocket.instances[0]
        socket.open()

        // Cycle 1: synchronous throw → degraded (cold start → empty)
        fireHeartbeat()
        await flushLong()
        expect(calls).toBe(1)
        expect(socket.sent.length).toBe(1)
        expect(JSON.parse(socket.sent[0]).sessions).toEqual([])
        expect(conn.connected).toBe(true)

        // Cycle 2: with maxOutstandingGathers=1, a leaked slot would hit the cap
        // and skip getSessions. The call proves the slot was released.
        fireHeartbeat()
        await flushLong()
        expect(calls).toBe(2)
        expect(socket.sent.length).toBe(2)
        expect(JSON.parse(socket.sent[1]).sessions).toEqual([])

        // Switch to fresh → recovers to fresh payloads
        mode = "fresh"
        fireHeartbeat()
        await flushLong()
        expect(calls).toBe(3)
        expect(socket.sent.length).toBe(3)
        expect(JSON.parse(socket.sent[2]).sessions).toEqual(freshSessions)

        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    })
  })

  // -------------------------------------------------------------------------
  // AC6: freshness-fenced attach — heartbeat() resolves only on a fresh send
  // over a live socket; survives transient reconnect; rejects on close()
  // -------------------------------------------------------------------------

  test("AC6a: heartbeat() does not resolve on degraded, resolves on the next fresh send", async () => {
    await withFakeWebSocket(async (clock) => {
      let mode: "wedge" | "fresh" = "wedge"
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () =>
        mode === "wedge"
          ? new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {})
          : Promise.resolve({ sessions: freshSessions })

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Degraded cycle: promise stays pending
      const promise1 = conn.heartbeat()
      let settled1 = false
      void promise1.then(
        () => {
          settled1 = true
        },
        () => {},
      )
      clock.advance(1000)
      await flushLong()
      expect(socket.sent.length).toBe(1)
      expect(settled1).toBe(false)

      // Fresh cycle: both the deferred promise1 and the new promise2 resolve
      mode = "fresh"
      const promise2 = conn.heartbeat()
      let settled2 = false
      void promise2.then(
        () => {
          settled2 = true
        },
        () => {},
      )
      await flushLong()
      expect(socket.sent.length).toBe(2)
      expect(JSON.parse(socket.sent[1]).sessions).toEqual(freshSessions)
      expect(settled1).toBe(true)
      expect(settled2).toBe(true)
    })
  })

  test("AC6b: pending heartbeat() survives disconnect+reconnect and resolves on fresh send over the new socket", async () => {
    await withFakeWebSocket(async (clock) => {
      let mode: "wedge" | "fresh" = "wedge"
      const freshSessions = [
        { id: "fresh", status: "active" as const, title: "Fresh" },
      ] as RemoteWS.SessionInfo[]
      const getSessions = () =>
        mode === "wedge"
          ? new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {})
          : Promise.resolve({ sessions: freshSessions })

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket1 = FakeWebSocket.instances[0]
      socket1.open()

      // Cycle 1 on socket1: wedge → degraded send, waiter pending
      const promise = conn.heartbeat()
      let settled = false
      void promise.then(
        () => {
          settled = true
        },
        () => {},
      )
      clock.advance(1000)
      await flushLong()
      expect(socket1.sent.length).toBe(1)
      expect(settled).toBe(false)

      // Transient disconnect
      socket1.disconnect(1000, "transient")
      await flush()
      expect(conn.connected).toBe(false)

      // Switch to fresh before reconnect so the next gather is fresh
      mode = "fresh"

      // Reconnect after backoff
      clock.advance(1000)
      await flush()
      expect(FakeWebSocket.instances.length).toBe(2)
      const socket2 = FakeWebSocket.instances[1]
      socket2.open()
      await flushLong()
      expect(conn.connected).toBe(true)

      // The onopen handler kicks a cycle because waiters > 0; that fresh
      // cycle sends over socket2 and resolves the deferred waiter.
      expect(socket2.sent.length).toBe(1)
      const payload = JSON.parse(socket2.sent[0])
      expect(payload.type).toBe("heartbeat")
      expect(payload.sessions).toEqual(freshSessions)
      expect(settled).toBe(true)
    })
  })

  test("AC6c: pending heartbeat() rejects (does not hang) when close() is called", async () => {
    await withFakeWebSocket(async (clock) => {
      const getSessions = () =>
        new Promise<{ sessions: RemoteWS.SessionInfo[] }>(() => {}) // wedge

      conn = RemoteWS.connect({
        url: "ws://example.test",
        getToken: async () => "tok",
        getSessions,
        log: nolog(),
        heartbeat: 60_000,
        timers: clock,
        now: () => clock.now,
        timeout: 300_000,
        gatherTimeout: 1000,
      })

      await flush()
      const socket = FakeWebSocket.instances[0]
      socket.open()

      // Cycle 1: wedge → degraded send, waiter pending
      const promise = conn.heartbeat()
      let resolved = false
      let rejected = false
      let rejectionError: unknown
      void promise.then(
        () => {
          resolved = true
        },
        (err) => {
          rejected = true
          rejectionError = err
        },
      )
      clock.advance(1000)
      await flushLong()
      expect(socket.sent.length).toBe(1)
      expect(resolved).toBe(false)
      expect(rejected).toBe(false)

      // Close: pending waiter must reject (not hang)
      conn.close()
      conn = undefined
      await flush()
      expect(resolved).toBe(false)
      expect(rejected).toBe(true)
      expect(String(rejectionError)).toContain("remote-ws connection closed")
    })
  })
})
