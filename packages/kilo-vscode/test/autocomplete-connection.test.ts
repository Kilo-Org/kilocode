import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
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

let fimReply: Reply = { status: 200, body: { output: { text: "hello", cost: 0.1, inputTokens: 1, outputTokens: 2 } } }
let editReply: Reply = { status: 200, body: { output: { content: "edited" } } }
let balanceReply: Reply = { status: 200, body: { output: { balance: 12.5 } } }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const rpcError = (type: string, message: string, data?: unknown) => ({ _tag: "RpcError", type, message, data })

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
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    if (url.pathname === "/api/rpc/kilocode.gateway/autocomplete.fim") return json(fimReply.body, fimReply.status)
    if (url.pathname === "/api/rpc/kilocode.gateway/autocomplete.edit") return json(editReply.body, editReply.status)
    if (url.pathname === "/api/rpc/kilocode.gateway/balance") return json(balanceReply.body, balanceReply.status)
    return json({ _tag: "RpcError", type: "failed", message: "unknown route" }, 400)
  },
})

function create() {
  const manager = {
    get: async () => ({ url: `http://127.0.0.1:${server.port}`, authorization: AUTHORIZATION }),
  } as unknown as Manager
  return createConnection({ server: manager, directory: DIRECTORY })
}

const request = { prefix: "", suffix: "" }

describe("createConnection", () => {
  beforeAll(() => {
    calls.length = 0
  })

  beforeEach(() => {
    calls.length = 0
    fimReply = { status: 200, body: { output: { text: "hello", cost: 0.1, inputTokens: 1, outputTokens: 2 } } }
    editReply = { status: 200, body: { output: { content: "edited" } } }
    balanceReply = { status: 200, body: { output: { balance: 12.5 } } }
  })

  afterAll(() => {
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

  it("returns the edit result on success", async () => {
    const connection = create()

    const result = await connection.edit({
      currentFilePath: "/repo/file.ts",
      currentFileContent: "",
      cursorLine: 0,
      cursorCharacter: 0,
      editableRegionStartLine: 0,
      editableRegionEndLine: 0,
      recentlyViewedSnippets: [],
      editDiffHistory: [],
    })

    expect(result).toEqual({ content: "edited", usage: undefined })
  })

  it("maps a `request` RPC error to AutocompleteRequestError with the status and message", async () => {
    fimReply = { status: 400, body: { _tag: "RpcError", type: "request", message: "rate limited", data: { status: 429 } } }
    const connection = create()

    const error = await connection.fim(request).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(AutocompleteRequestError)
    expect((error as AutocompleteRequestError).status).toBe(429)
    expect((error as AutocompleteRequestError).message).toBe("FIM request failed: 429 rate limited")
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
})
