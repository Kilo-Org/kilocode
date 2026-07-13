import { afterEach, describe, expect, test } from "bun:test"
import { EventServiceClient } from "@/kilocode/event-service/client"

const OriginalWebSocket = globalThis.WebSocket
const OriginalFetch = globalThis.fetch
const OriginalSetTimeout = globalThis.setTimeout
const OriginalClearTimeout = globalThis.clearTimeout

type WsListener = (event: unknown) => void

class FakeWebSocket {
  static readonly OPEN = 1
  readonly url: string
  readonly protocols: string | string[] | undefined
  readyState = 0
  readonly sent: string[] = []
  closedWith: { code?: number; reason?: string } | null = null
  private readonly listeners = new Map<string, Set<WsListener>>()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    sockets.push(this)
  }

  addEventListener(type: string, listener: WsListener): void {
    const set = this.listeners.get(type) ?? new Set<WsListener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  emitOpen(): void {
    this.readyState = 1
    for (const l of this.listeners.get("open") ?? []) l({})
  }

  emitMessage(data: string): void {
    for (const l of this.listeners.get("message") ?? []) l({ data })
  }

  emitClose(code: number, reason = ""): void {
    if (this.readyState !== 3) this.readyState = 3
    for (const l of this.listeners.get("close") ?? []) l({ code, reason })
  }

  emitError(): void {
    for (const l of this.listeners.get("error") ?? []) l({})
  }
}

const sockets: FakeWebSocket[] = []
let client: EventServiceClient | undefined

function useFakeWebSocket(): void {
  Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true, writable: true })
}

function ticketBody(ticket = "t"): Response {
  return new Response(JSON.stringify({ ticket }), { status: 200, headers: { "content-type": "application/json" } })
}

function statusBody(status: number): Response {
  return new Response("", { status })
}

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : new Request(input).url
    return Promise.resolve(handler(url, init))
  }) as unknown as typeof globalThis.fetch
}

function installTimers() {
  const callbacks = new Map<number, () => void>()
  const scheduled: { delay: number }[] = []
  let nextId = 1
  globalThis.setTimeout = ((cb: () => void, delay?: number) => {
    const id = nextId++
    callbacks.set(id, cb)
    scheduled.push({ delay: delay ?? 0 })
    return id
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id?: unknown) => {
    if (typeof id === "number") callbacks.delete(id)
  }) as unknown as typeof clearTimeout
  return {
    flush() {
      const cbs = [...callbacks.values()]
      callbacks.clear()
      for (const cb of cbs) cb()
    },
    size() {
      return callbacks.size
    },
    scheduled,
  }
}

async function drain(n = 30): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

afterEach(() => {
  client?.disconnect()
  client = undefined
  sockets.length = 0
  Object.defineProperty(globalThis, "WebSocket", { value: OriginalWebSocket, configurable: true, writable: true })
  globalThis.fetch = OriginalFetch
  globalThis.setTimeout = OriginalSetTimeout
  globalThis.clearTimeout = OriginalClearTimeout
})

describe("EventServiceClient transport", () => {
  test("401 ticket response is fatal and fires onUnauthorized", async () => {
    useFakeWebSocket()
    installFetch(() => statusBody(401))
    let unauthorized = false
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      onUnauthorized: () => (unauthorized = true),
    })
    await client.connect()
    expect(unauthorized).toBe(true)
    expect(client.isConnected()).toBe(false)
    expect(sockets.length).toBe(0)
  })

  test("403 ticket response is fatal and fires onUnauthorized", async () => {
    useFakeWebSocket()
    installFetch(() => statusBody(403))
    let unauthorized = false
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      onUnauthorized: () => (unauthorized = true),
    })
    await client.connect()
    expect(unauthorized).toBe(true)
    expect(sockets.length).toBe(0)
  })

  test("handshake timeout closes the socket with handshake-timeout and is transient", async () => {
    useFakeWebSocket()
    installFetch(() => ticketBody())
    const timers = installTimers()
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      handshakeTimeoutMs: 40,
    })
    void client.connect()
    await drain()
    expect(sockets.length).toBe(1)
    expect(timers.scheduled.some((s) => s.delay === 40)).toBe(true)
    timers.flush()
    expect(sockets[0].closedWith?.code).toBe(1000)
    expect(sockets[0].closedWith?.reason).toBe("handshake-timeout")
    await drain()
    expect(timers.size()).toBe(1)
  })

  test("transient close code schedules a reconnect that opens a new socket", async () => {
    useFakeWebSocket()
    installFetch(() => ticketBody())
    const timers = installTimers()
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      handshakeTimeoutMs: 5000,
    })
    const p = client.connect()
    await drain()
    expect(sockets.length).toBe(1)
    sockets[0].emitOpen()
    await p
    expect(client.isConnected()).toBe(true)
    sockets[0].emitClose(1006)
    expect(timers.size()).toBe(1)
    timers.flush()
    await drain()
    expect(sockets.length).toBe(2)
    sockets[1].emitOpen()
    await drain()
    expect(client.isConnected()).toBe(true)
  })

  test("reconnect replays active contexts and fires onReconnect", async () => {
    useFakeWebSocket()
    installFetch(() => ticketBody())
    const timers = installTimers()
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      handshakeTimeoutMs: 5000,
    })
    let reconnectFired = false
    client.onReconnect(() => (reconnectFired = true))
    const p = client.connect()
    await drain()
    sockets[0].emitOpen()
    await p
    expect(reconnectFired).toBe(false)
    client.subscribe(["ctx-1"])
    expect(sockets[0].sent).toContain(JSON.stringify({ type: "context.subscribe", contexts: ["ctx-1"] }))
    sockets[0].emitClose(1006)
    timers.flush()
    await drain()
    expect(sockets.length).toBe(2)
    sockets[1].emitOpen()
    await drain()
    expect(reconnectFired).toBe(true)
    expect(JSON.parse(sockets[1].sent[0])).toEqual({ type: "context.subscribe", contexts: ["ctx-1"] })
  })

  test("unsubscribe sends while connected and disconnect closes the socket", async () => {
    useFakeWebSocket()
    installFetch(() => ticketBody())
    client = new EventServiceClient({ url: "wss://events.test", getToken: async () => "tok" })
    const p = client.connect()
    await drain()
    sockets[0].emitOpen()
    await p
    client.subscribe(["ctx-1"])
    client.unsubscribe(["ctx-1"])
    expect(sockets[0].sent).toContain(JSON.stringify({ type: "context.unsubscribe", contexts: ["ctx-1"] }))
    client.disconnect()
    expect(client.isConnected()).toBe(false)
    expect(sockets[0].closedWith).not.toBeNull()
  })

  test("disposal during token lookup does not start a ticket request", async () => {
    useFakeWebSocket()
    let resolveToken!: (token: string) => void
    const token = new Promise<string>((resolve) => (resolveToken = resolve))
    let requests = 0
    installFetch(() => {
      requests++
      return ticketBody()
    })
    client = new EventServiceClient({ url: "wss://events.test", getToken: () => token })

    const pending = client.connect()
    await drain()
    client.disconnect()
    resolveToken("tok")
    await pending

    expect(requests).toBe(0)
    expect(sockets.length).toBe(0)
  })

  test("disconnect aborts ticket requests from concurrent connect attempts", async () => {
    useFakeWebSocket()
    installTimers()
    const signals: AbortSignal[] = []
    installFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) return
          signals.push(signal)
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        }),
    )
    client = new EventServiceClient({ url: "wss://events.test", getToken: async () => "tok" })

    void client.connect()
    await drain()
    void client.connect()
    await drain()
    expect(signals).toHaveLength(2)

    client.disconnect()
    await drain()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  test("disposal during ticket minting never creates a socket", async () => {
    useFakeWebSocket()
    let resolveFetch!: (r: Response) => void
    const fetchPromise = new Promise<Response>((r) => (resolveFetch = r))
    installFetch(() => fetchPromise)
    client = new EventServiceClient({ url: "wss://events.test", getToken: async () => "tok" })
    const p = client.connect()
    await drain()
    expect(sockets.length).toBe(0)
    client.disconnect()
    resolveFetch(ticketBody())
    await p
    expect(sockets.length).toBe(0)
    expect(client.isConnected()).toBe(false)
  })

  test("disposal suppresses a late unauthorized ticket response", async () => {
    useFakeWebSocket()
    let resolveFetch!: (r: Response) => void
    const fetchPromise = new Promise<Response>((r) => (resolveFetch = r))
    installFetch(() => fetchPromise)
    let unauthorized = false
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      onUnauthorized: () => (unauthorized = true),
    })
    const p = client.connect()
    await drain()
    client.disconnect()
    resolveFetch(statusBody(401))
    await p
    expect(unauthorized).toBe(false)
  })

  test("disposal during handshake closes the socket and ignores a late open", async () => {
    useFakeWebSocket()
    installFetch(() => ticketBody())
    client = new EventServiceClient({
      url: "wss://events.test",
      getToken: async () => "tok",
      handshakeTimeoutMs: 5000,
    })
    const p = client.connect()
    await drain()
    expect(sockets.length).toBe(1)
    expect(sockets[0].readyState).toBe(0)
    client.disconnect()
    await drain()
    sockets[0].emitOpen()
    await drain()
    expect(client.isConnected()).toBe(false)
    expect(sockets[0].closedWith).not.toBeNull()
    expect(sockets.length).toBe(1)
    await p
  })
})
