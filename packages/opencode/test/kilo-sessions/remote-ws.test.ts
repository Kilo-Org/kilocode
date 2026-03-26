import { afterEach, describe, expect, test } from "bun:test"
import { RemoteWS } from "../../src/kilo-sessions/remote-ws"
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
  const pending: {
    connect: ((ws: ServerWebSocket<unknown>) => void)[]
    message: ((msg: string) => void)[]
  } = { connect: [], message: [] }

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
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
      getSessions: () => [{ id: "s1", status: "active", title: "Test" }],
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

  test("buffers when disconnected, flushes on reconnect", async () => {
    server = createServer()
    const connecting = server.waitForConnect()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: () => [],
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
      getSessions: () => [],
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

  test("stops reconnecting on 4401", async () => {
    server = createServer()

    conn = RemoteWS.connect({
      url: server.url,
      getToken: async () => "tok",
      getSessions: () => [],
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
      getSessions: () => [],
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
      getSessions: () => [],
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
      getSessions: () => [{ id: "s1", status: "active", title: "Test" }],
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
})
