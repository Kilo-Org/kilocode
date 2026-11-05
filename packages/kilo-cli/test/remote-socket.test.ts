import { afterEach, describe, expect, jest, test } from "bun:test"
import { RemoteSocket, type RemoteEnvelope, type RemoteSocketOptions } from "../src/remote/socket"

const ticket = () => Promise.resolve({ ticket: "test-ticket", expiresAt: new Date(Date.now() + 120_000).toISOString() })
const envelope = (type: string, body: unknown = null, channel: RemoteEnvelope["channel"] = "control") => ({
  v: 1,
  channel,
  seq: 0,
  from: "server",
  at: Date.now(),
  type,
  body,
})
const schedule = (reauthAt = Date.now() + 60_000, expiresAt = Date.now() + 120_000) => ({
  expiresAt: new Date(expiresAt).toISOString(),
  reauthAt: new Date(reauthAt).toISOString(),
  reconnectAfterMs: 1000,
})

async function advance(milliseconds: number) {
  jest.advanceTimersByTime(milliseconds)
  await Promise.resolve()
  jest.advanceTimersByTime(0)
}

async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Remote socket condition timed out")
    await advance(5)
  }
}

function fixture(options: Partial<RemoteSocketOptions> = {}) {
  jest.useFakeTimers()
  const connections: FakeSocket[] = []
  class FakeSocket extends EventTarget {
    readyState = 0
    sent: string[] = []

    constructor(
      readonly url: string,
      readonly options: { headers: Record<string, string> },
    ) {
      super()
      connections.push(this)
      queueMicrotask(() => {
        if (this.readyState !== 0) return
        this.readyState = 1
        this.dispatchEvent(new Event("open"))
      })
    }

    send(data: string) {
      this.sent.push(data)
    }

    frame(type: string, body?: unknown, channel?: RemoteEnvelope["channel"]) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(envelope(type, body, channel)) }))
    }

    close(code = 1000) {
      if (this.readyState === 3) return
      this.readyState = 3
      this.dispatchEvent(new CloseEvent("close", { code }))
    }
  }
  const socket = new RemoteSocket({
    url: "https://remote.example.test/v1/presence",
    ticket,
    onFrame: () => {},
    socket: FakeSocket,
    ...options,
  })
  return { socket, connections }
}

describe("RemoteSocket", () => {
  afterEach(() => jest.useRealTimers())
  test("uses bearer upgrade headers and renews over a real WebSocket", async () => {
    const seen: string[] = []
    const reauthorized = Promise.withResolvers<void>()
    const upgrade: { authorization: string | null } = { authorization: null }
    let path = ""
    let count = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        upgrade.authorization = request.headers.get("authorization")
        path = new URL(request.url).pathname + new URL(request.url).search
        if (server.upgrade(request)) return
        return new Response(null, { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify(envelope("hello", schedule(Date.now() - 1))))
        },
        message(ws, message) {
          seen.push(String(message))
          ws.send(JSON.stringify(envelope("reauthorized", schedule())))
        },
      },
    })
    const socket = new RemoteSocket({
      url: `http://127.0.0.1:${server.port}/v1/presence`,
      ticket: async () => ({ ticket: `ticket-${++count}`, expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      onFrame: (frame) => {
        if (frame.type === "reauthorized") reauthorized.resolve()
      },
    })
    try {
      socket.start()
      await reauthorized.promise
      expect(socket.connected).toBe(true)
      expect(upgrade.authorization).toBe("Bearer ticket-1")
      expect(path).toBe("/v1/presence")
      expect(seen).toEqual([JSON.stringify({ type: "reauth", ticket: "ticket-2" })])
    } finally {
      socket.stop()
      await server.stop(true)
    }
  })

  test("start and stop are idempotent and publish state transitions once", async () => {
    const states: boolean[] = []
    const f = fixture({
      onState: (value) => {
        states.push(value)
      },
    })
    try {
      f.socket.start()
      f.socket.start()
      await until(() => f.socket.connected)
      expect(f.connections).toHaveLength(1)
      expect(f.connections[0]!.url).toBe("wss://remote.example.test/v1/presence")
      expect(f.connections[0]!.options.headers).toEqual({ Authorization: "Bearer test-ticket" })
      f.socket.stop()
      f.socket.stop()
      expect(states).toEqual([true, false])
      expect(jest.getTimerCount()).toBe(0)
      expect(f.socket.send({ type: "heartbeat" })).toBe(false)
    } finally {
      f.socket.stop()
    }
  })

  test("awaits frame handlers in wire order", async () => {
    const entered: string[] = []
    const gate = Promise.withResolvers<void>()
    const f = fixture({
      onFrame: async (frame) => {
        entered.push(frame.type)
        if (frame.type === "first") await gate.promise
      },
    })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("first")
      f.connections[0]!.frame("second")
      await until(() => entered.length === 1)
      expect(entered).toEqual(["first"])
      gate.resolve()
      await until(() => entered.length === 2)
      expect(entered).toEqual(["first", "second"])
    } finally {
      gate.resolve()
      f.socket.stop()
    }
  })

  test("session replacement is terminal, but an explicit start can resume", async () => {
    const f = fixture({ terminalReplacement: true })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.close(4009)
      expect(f.socket.connected).toBe(false)
      await advance(2100)
      expect(f.connections).toHaveLength(1)
      f.socket.start()
      await until(() => f.connections.length === 2 && f.socket.connected)
    } finally {
      f.socket.stop()
    }
  })

  test("presence replacement reconnects no sooner than the server hint", async () => {
    const f = fixture()
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("hello", { ...schedule(), reconnectAfterMs: 1200 })
      f.connections[0]!.close(4009)
      await advance(1000)
      expect(f.connections).toHaveLength(1)
      await until(() => f.connections.length === 2 && f.socket.connected)
    } finally {
      f.socket.stop()
    }
  })

  test("stopping during ticket minting fences the stale connection", async () => {
    const pending = Promise.withResolvers<{ ticket: string; expiresAt: string }>()
    let requests = 0
    const f = fixture({ ticket: () => (++requests === 1 ? pending.promise : ticket()) })
    try {
      f.socket.start()
      f.socket.stop()
      f.socket.start()
      await until(() => f.socket.connected)
      pending.resolve(await ticket())
      await advance(10)
      expect(f.connections).toHaveLength(1)
    } finally {
      f.socket.stop()
    }
  })

  test("reauthorized replaces renewal timers and reauth_required renews immediately", async () => {
    let requests = 0
    const f = fixture({ ticket: async () => ({ ...(await ticket()), ticket: String(++requests) }) })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("hello", schedule(Date.now() - 1))
      await until(() => f.connections[0]!.sent.length === 1)
      expect(JSON.parse(f.connections[0]!.sent[0]!)).toEqual({ type: "reauth", ticket: "2" })
      f.connections[0]!.frame("reauthorized", schedule())
      f.connections[0]!.frame("reauth_required", { expiresAt: schedule().expiresAt })
      await until(() => f.connections[0]!.sent.length === 2)
      expect(JSON.parse(f.connections[0]!.sent[1]!)).toEqual({ type: "reauth", ticket: "3" })
      f.connections[0]!.frame("reauthorized", schedule())
      await advance(20)
      expect(requests).toBe(3)
    } finally {
      f.socket.stop()
    }
  })

  test("unacknowledged renewal cannot extend the authorization deadline", async () => {
    const never = Promise.withResolvers<{ ticket: string; expiresAt: string }>()
    let requests = 0
    const f = fixture({ ticket: () => (++requests === 1 ? ticket() : never.promise) })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("hello", schedule(Date.now() - 1, Date.now() + 60))
      await until(() => !f.socket.connected)
      expect(f.socket.send({ type: "ack", commandID: "expired" })).toBe(false)
    } finally {
      f.socket.stop()
      never.resolve(await ticket())
    }
  })

  test("ticket failures retry without constructing an unauthenticated socket", async () => {
    let requests = 0
    const f = fixture({ ticket: () => (++requests === 1 ? Promise.reject(new Error("unavailable")) : ticket()) })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      expect(requests).toBe(2)
      expect(f.connections).toHaveLength(1)
    } finally {
      f.socket.stop()
    }
  })

  test("renewal failure disconnects instead of continuing with stale credentials", async () => {
    let requests = 0
    const f = fixture({ ticket: () => (++requests === 1 ? ticket() : Promise.reject(new Error("expired grant"))) })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("hello", schedule(Date.now() - 1))
      await until(() => !f.socket.connected)
      expect(f.connections[0]!.readyState).toBe(3)
    } finally {
      f.socket.stop()
    }
  })

  test("rejects malformed and oversized inbound frames", async () => {
    for (const data of ["not-json", JSON.stringify({ type: "hello" }), "x".repeat(65_537)]) {
      const frames: RemoteEnvelope[] = []
      const f = fixture({
        onFrame: (frame) => {
          frames.push(frame)
        },
      })
      try {
        f.socket.start()
        await until(() => f.socket.connected)
        f.connections[0]!.dispatchEvent(new MessageEvent("message", { data }))
        expect(f.socket.connected).toBe(false)
        expect(frames).toEqual([])
      } finally {
        f.socket.stop()
      }
    }
  })

  test("outbound sends are bounded by UTF-8 bytes and never buffered", async () => {
    const f = fixture()
    try {
      expect(f.socket.send({ type: "ack" })).toBe(false)
      f.socket.start()
      await until(() => f.socket.connected)
      expect(f.socket.send({ type: "ack", commandID: "one" })).toBe(true)
      expect(f.socket.send({ body: "é".repeat(40_000) })).toBe(false)
      expect(f.socket.send(undefined)).toBe(false)
      const cyclic: { self?: unknown } = {}
      cyclic.self = cyclic
      expect(f.socket.send(cyclic)).toBe(false)
      expect(f.connections[0]!.sent).toEqual([JSON.stringify({ type: "ack", commandID: "one" })])
    } finally {
      f.socket.stop()
    }
  })

  test("handler failure disconnects and suppresses already queued stale frames", async () => {
    const frames: string[] = []
    const f = fixture({
      onFrame: async (frame) => {
        frames.push(frame.type)
        throw new Error("admission failed")
      },
    })
    try {
      f.socket.start()
      await until(() => f.socket.connected)
      f.connections[0]!.frame("first")
      f.connections[0]!.frame("second")
      await until(() => !f.socket.connected)
      expect(frames).toEqual(["first"])
    } finally {
      f.socket.stop()
    }
  })
})
