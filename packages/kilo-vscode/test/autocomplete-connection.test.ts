import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { ErrorBackoff } from "../src/services/autocomplete/classic-auto-complete/ErrorBackoff"
import { AutocompleteRequestError, createConnection } from "../src/services/autocomplete/connection"
import type { Manager } from "../src/server"

const DIRECTORY = "/some/project"
const AUTHORIZATION = "Basic test-token"

type Reply = { status: number; body: unknown }

type Call = {
  path: string
  authorization: string | null
  directory: string | null
}

const calls: Call[] = []

const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
let eventHandler: ((request: Request) => Response) | undefined

let fimReply: Reply = { status: 200, body: { output: { text: "hello", cost: 0.1, inputTokens: 1, outputTokens: 2 } } }
let balanceReply: Reply = { status: 200, body: { output: { balance: 12.5 } } }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const rpcError = (type: string, message: string, data?: unknown) => ({ _tag: "RpcError", type, message, data })

function frame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function openStream(connected = true) {
  let active: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      active = controller
      streams.add(controller)
      if (connected)
        controller.enqueue(encoder.encode(frame({ type: "server.connected", id: "evt_0", created: 0, data: {} })))
    },
    cancel() {
      if (active) streams.delete(active)
    },
  })
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
}

function emit(event: unknown) {
  for (const controller of [...streams]) controller.enqueue(encoder.encode(frame(event)))
}

function dropStreams() {
  for (const controller of [...streams]) {
    streams.delete(controller)
    try {
      controller.close()
    } catch {
      // Already closed.
    }
  }
}

async function until(check: () => boolean, label = "condition") {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    calls.push({
      path: url.pathname,
      authorization: request.headers.get("authorization"),
      directory: url.searchParams.get("location[directory]"),
    })
    if (url.pathname === "/api/event") {
      if (eventHandler) return eventHandler(request)
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    if (url.pathname === "/api/rpc/kilocode.gateway/autocomplete.fim") return json(fimReply.body, fimReply.status)
    if (url.pathname === "/api/rpc/kilocode.gateway/balance") return json(balanceReply.body, balanceReply.status)
    return json({ _tag: "RpcError", type: "failed", message: "unknown route" }, 400)
  },
})

function create(opts?: { reconnect?: number; maxReconnect?: number }) {
  const manager = {
    get: async () => ({ url: `http://127.0.0.1:${server.port}`, authorization: AUTHORIZATION }),
  } as unknown as Manager
  return createConnection({ server: manager, directory: DIRECTORY, ...opts })
}

const request = { prefix: "", suffix: "" }

describe("createConnection", () => {
  beforeAll(() => {
    calls.length = 0
  })

  beforeEach(() => {
    calls.length = 0
    eventHandler = undefined
    dropStreams()
    fimReply = { status: 200, body: { output: { text: "hello", cost: 0.1, inputTokens: 1, outputTokens: 2 } } }
    balanceReply = { status: 200, body: { output: { balance: 12.5 } } }
  })

  afterAll(() => {
    dropStreams()
    server.stop(true)
  })

  it("sends the authorization header and the directory location query", async () => {
    const connection = create()

    await connection.fim(request)

    const call = calls.find((item) => item.path.endsWith("/autocomplete.fim"))
    expect(call?.authorization).toBe(AUTHORIZATION)
    expect(call?.directory).toBe(DIRECTORY)
  })

  it("returns the FIM result on success", async () => {
    const connection = create()

    const result = await connection.fim(request)

    expect(result).toEqual({ text: "hello", cost: 0.1, inputTokens: 1, outputTokens: 2 })
  })

  it("maps a `request` RPC error to AutocompleteRequestError with the status and message", async () => {
    fimReply = { status: 400, body: { _tag: "RpcError", type: "request", message: "rate limited", data: { status: 429 } } }
    const connection = create()

    const error = await connection.fim(request).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(AutocompleteRequestError)
    expect((error as AutocompleteRequestError).status).toBe(429)
    expect((error as AutocompleteRequestError).message).toBe("FIM request failed: 429 rate limited")
  })

  it("keeps a provider failure message that already names the request", async () => {
    fimReply = {
      status: 400,
      body: { _tag: "RpcError", type: "request", message: "FIM request failed: 401 invalid key", data: { status: 401 } },
    }
    const error = await create().fim(request).catch((value: unknown) => value)

    expect((error as AutocompleteRequestError).status).toBe(401)
    expect((error as AutocompleteRequestError).message).toBe("FIM request failed: 401 invalid key")
  })

  it("maps an `unauthorized` RPC error to status 401", async () => {
    fimReply = { status: 400, body: rpcError("unauthorized", "no creds") }
    const connection = create()

    const error = await connection.fim(request).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(AutocompleteRequestError)
    expect((error as AutocompleteRequestError).status).toBe(401)
    expect((error as AutocompleteRequestError).message).toBe("FIM request failed: 401 no creds")
  })

  it("does not wrap an aborted request", async () => {
    const connection = create()
    const controller = new AbortController()
    controller.abort()

    const error = await connection.fim(request, controller.signal).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(AutocompleteRequestError)
  })

  it("returns the balance on success and undefined on failure", async () => {
    const connection = create()
    expect(await connection.balance()).toBe(12.5)

    balanceReply = { status: 400, body: rpcError("failed", "unavailable") }
    expect(await connection.balance()).toBeUndefined()
  })

  it("tracks server state and notifies listeners", () => {
    const connection = create()

    expect(connection.connected()).toBe(false)

    let changes = 0
    const unsubscribe = connection.onStateChange(() => changes++)

    connection.started()
    expect(connection.connected()).toBe(true)
    expect(changes).toBe(1)

    connection.stopped()
    expect(connection.connected()).toBe(false)
    expect(changes).toBe(2)

    unsubscribe()
    connection.started()
    expect(changes).toBe(2)

    connection.dispose()
  })

  it("notifies onAuthChange for auth and organization events but ignores unrelated events", async () => {
    eventHandler = () => openStream()
    const connection = create({ reconnect: 10 })
    let authEvents = 0
    connection.onAuthChange(() => authEvents++)

    connection.started()
    await until(() => streams.size === 1, "initial SSE stream")

    emit({ type: "provider.updated", id: "evt_1", created: 1, data: {} })
    emit({ type: "session.idle", id: "evt_2", created: 2, data: { sessionID: "s1" } })
    emit({ type: "credential.updated", id: "evt_3", created: 3, data: { integrationID: "kilo", credentialID: "c1" } })
    emit({ type: "credential.switched", id: "evt_4", created: 4, data: { integrationID: "kilo", credentialID: "c1" } })
    emit({
      type: "rpc.kilocode.gateway.organization",
      id: "evt_5",
      created: 5,
      data: { organizationID: "org_1" },
    })

    await until(() => authEvents === 3, "auth notifications")
    expect(authEvents).toBe(3)
    connection.dispose()
  })

  it("reconnects after a transient SSE drop and continues delivering onAuthChange", async () => {
    eventHandler = () => openStream()
    const connection = create({ reconnect: 10, maxReconnect: 40 })
    let authEvents = 0
    connection.onAuthChange(() => authEvents++)

    connection.started()
    await until(() => streams.size === 1, "first SSE stream")
    expect(authEvents).toBe(0)

    // Drop the SSE stream without restarting the server.
    dropStreams()
    await until(
      () => calls.filter((call) => call.path === "/api/event").length === 2 && streams.size === 1 && authEvents === 1,
      "reconnected SSE stream",
    )

    // Subsequent re-login events on the reconnected stream still fire onAuthChange.
    emit({ type: "credential.switched", id: "evt_relogin", created: 10, data: { integrationID: "kilo", credentialID: "c2" } })
    await until(() => authEvents === 2, "post-reconnect credential.switched")
    expect(authEvents).toBe(2)

    connection.dispose()
  })

  it("backs off across consecutive SSE failures and recovers once the stream returns", async () => {
    const timestamps: number[] = []
    let attempt = 0
    eventHandler = () => {
      timestamps.push(Date.now())
      attempt++
      if (attempt <= 3) return new Response("unavailable", { status: 503 })
      return openStream()
    }

    const connection = create({ reconnect: 20, maxReconnect: 80 })
    let authEvents = 0
    connection.onAuthChange(() => authEvents++)

    connection.started()
    await until(() => attempt === 4 && streams.size === 1, "eventual SSE connect after failures")

    // Delay after attempt 2 (40ms) should be longer than delay after attempt 1 (20ms), and initial connect after
    // failures should not fire a spurious onAuthChange.
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(25)
    expect(timestamps[3]! - timestamps[2]!).toBeGreaterThanOrEqual(50)
    expect(authEvents).toBe(0)

    emit({ type: "credential.switched", id: "evt_after_fail", created: 1, data: { integrationID: "kilo", credentialID: "c1" } })
    await until(() => authEvents === 1, "auth event after recovery")
    connection.dispose()
  })

  it("stops reconnecting immediately when stopped during backoff", async () => {
    let attempts = 0
    eventHandler = () => {
      attempts++
      return new Response("unavailable", { status: 503 })
    }

    const connection = create({ reconnect: 50, maxReconnect: 200 })
    connection.started()
    await until(() => attempts === 1, "first failed SSE attempt")

    connection.stopped()
    await Bun.sleep(100)
    expect(attempts).toBe(1)
    connection.dispose()
  })

  it("recovers ErrorBackoff from a 401 fatal lock after an SSE drop and re-login", async () => {
    eventHandler = () => openStream()
    const connection = create({ reconnect: 10, maxReconnect: 40 })
    const backoff = new ErrorBackoff()
    connection.onAuthChange(() => backoff.reset())

    connection.started()
    await until(() => streams.size === 1, "initial SSE stream")

    // Simulate an SSE drop while connected, followed by a 401 FIM failure locking ErrorBackoff fatal.
    dropStreams()
    await until(
      () => calls.filter((call) => call.path === "/api/event").length === 2 && streams.size === 1,
      "reconnected SSE stream",
    )

    fimReply = { status: 400, body: rpcError("unauthorized", "not signed in") }
    const error = await connection.fim(request).catch((value: unknown) => value)
    expect(backoff.failure(error)).toBe("fatal")
    expect(backoff.getFatalStatus()).toBe(401)
    expect(backoff.blocked()).toBe(true)

    // Re-login arrives on the reconnected SSE stream and unlocks ErrorBackoff.
    emit({ type: "credential.switched", id: "evt_relogin_401", created: 2, data: { integrationID: "kilo", credentialID: "c2" } })
    await until(() => !backoff.blocked(), "ErrorBackoff reset after re-login")
    expect(backoff.getFatalStatus()).toBeNull()

    connection.dispose()
  })
})
