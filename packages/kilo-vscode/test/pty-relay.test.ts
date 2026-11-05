import { afterAll, describe, expect, it } from "bun:test"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { OpenCodeClient } from "@opencode/client"
import { PtyRelay } from "../src/agent-manager/pty-relay"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"

interface SocketData {
  ticket: string | null
}

const received: Array<{ ticket: string | null; data: string | Uint8Array }> = []
let clients: Bun.ServerWebSocket<SocketData>[] = []
let closed = 0

const http = Bun.serve<SocketData>({
  port: 0,
  fetch(request, server) {
    const url = new URL(request.url)
    if (!url.pathname.endsWith("/connect")) return new Response("not found", { status: 404 })
    if (!server.upgrade(request, { data: { ticket: url.searchParams.get("ticket") } }))
      return new Response("upgrade failed", { status: 500 })
  },
  websocket: {
    open(ws) {
      clients.push(ws)
    },
    message(ws, message) {
      received.push({
        ticket: ws.data.ticket,
        data: typeof message === "string" ? message : new Uint8Array(message),
      })
    },
    close(ws) {
      closed++
      clients = clients.filter((client) => client !== ws)
    },
  },
})

afterAll(() => http.stop(true))

function harness(options: { hold?: (ptyID: string) => Promise<void> } = {}) {
  received.length = 0
  clients = []
  const messages: AgentManagerOutMessage[] = []
  const tickets: string[] = []
  const client = {
    pty: {
      connect: {
        token: async ({ ptyID }: { ptyID: string }) => {
          const ticket = `ticket-${tickets.length + 1}-${ptyID}`
          tickets.push(ticket)
          await options.hold?.(ptyID)
          return { data: { ticket, expires_in: 30 } }
        },
      },
    },
  }
  const connection = {
    client: async () => client as unknown as OpenCodeClient,
    server: () => ({ url: `http://127.0.0.1:${http.port}`, authorization: "Basic test" }),
  } as unknown as AgentManagerConnection
  const relay = new PtyRelay({
    connection,
    terminal: (terminalId) => {
      if (terminalId === "terminal-1") return { ptyID: "pty-1", directory: "/workspace" }
      if (terminalId === "terminal-2") return { ptyID: "pty-2", directory: "/workspace" }
      return undefined
    },
    post: (message) => messages.push(message),
    log: () => undefined,
  })
  return { relay, messages, tickets }
}

function wait() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("condition not reached")
}

function post(relay: PtyRelay, message: Parameters<PtyRelay["handle"]>[0]) {
  expect(relay.handle(message)).toBe(true)
}

describe("PtyRelay", () => {
  it("opens a socket and forwards text frames both ways", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    await until(() => test.messages.some((message) => message.type === "agentManager.terminal.socket.opened"))
    expect(test.tickets).toEqual(["ticket-1-pty-1"])
    await until(() => clients.length === 1)

    clients[0]!.send("hello from the shell")
    await until(() => test.messages.some((message) => message.type === "agentManager.terminal.socket.message"))
    expect(test.messages.at(-1)).toEqual({
      type: "agentManager.terminal.socket.message",
      socketId: "s1",
      data: "hello from the shell",
    })

    post(test.relay, { type: "agentManager.terminal.socket.send", socketId: "s1", data: "ls\n" })
    await until(() => received.length === 1)
    expect(received[0]).toEqual({ ticket: "ticket-1-pty-1", data: "ls\n" })
    test.relay.dispose()
  })

  it("forwards binary frames as raw bytes in both directions", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    await until(() => clients.length === 1 && test.messages.length > 0)

    clients[0]!.send(new Uint8Array([0, 1, 2, 255]))
    await until(() => test.messages.some((message) => message.type === "agentManager.terminal.socket.message"))
    const message = test.messages.at(-1)
    if (message?.type !== "agentManager.terminal.socket.message") throw new Error("missing socket message")
    expect(message.data).toBeInstanceOf(Uint8Array)
    expect([...(message.data as Uint8Array)]).toEqual([0, 1, 2, 255])

    // A view into a larger buffer must not leak the surrounding bytes.
    const frame = new Uint8Array([9, 7, 5, 3])
    post(test.relay, {
      type: "agentManager.terminal.socket.send",
      socketId: "s1",
      data: frame.subarray(1, 3),
    })
    await until(() => received.length === 1)
    expect(received[0]?.data).toBeInstanceOf(Uint8Array)
    expect([...(received[0]!.data as Uint8Array)]).toEqual([7, 5])
    test.relay.dispose()
  })

  it("propagates a server close with its code and reason", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    await until(() => clients.length === 1 && test.messages.length > 0)

    clients[0]!.close(4001, "session exited")
    await until(() => test.messages.some((message) => message.type === "agentManager.terminal.socket.closed"))
    expect(test.messages.at(-1)).toEqual({
      type: "agentManager.terminal.socket.closed",
      socketId: "s1",
      code: 4001,
      reason: "session exited",
    })
    test.relay.dispose()
  })

  it("closes a socket when the webview asks", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    await until(() => clients.length === 1 && test.messages.length > 0)

    post(test.relay, { type: "agentManager.terminal.socket.close", socketId: "s1", code: 1000, reason: "done" })
    await until(() => clients.length === 0)
    await until(() => test.messages.some((message) => message.type === "agentManager.terminal.socket.closed"))
    test.relay.dispose()
  })

  it("closes every socket on dispose and on terminal close", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "a", terminalId: "terminal-1" })
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "b", terminalId: "terminal-1" })
    await until(() => clients.length === 2 && test.messages.filter((m) => m.type.endsWith(".opened")).length === 2)

    test.relay.closeTerminal("terminal-1")
    await until(() => clients.length === 0)

    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "c", terminalId: "terminal-1" })
    await until(() => clients.length === 1)
    const sockets = closed
    test.relay.dispose()
    await until(() => clients.length === 0)
    expect(closed).toBeGreaterThan(sockets)
  })

  it("cancels only the pending open of the terminal that closed", async () => {
    const waits = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
    const hold = (ptyID: string) => {
      const wait = waits.get(ptyID) ?? Promise.withResolvers<void>()
      waits.set(ptyID, wait)
      return wait.promise
    }
    const test = harness({ hold })
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s2", terminalId: "terminal-2" })
    await until(() => test.tickets.length === 2)

    test.relay.closeTerminal("terminal-2")
    for (const wait of waits.values()) wait.resolve()
    await until(() => clients.length === 1)
    expect(test.messages).toContainEqual({
      type: "agentManager.terminal.socket.closed",
      socketId: "s2",
      code: 1000,
      reason: "closed",
    })
    expect(test.messages.some((message) => message.type === "agentManager.terminal.socket.opened")).toBe(true)
    test.relay.dispose()
  })

  it("drops the sockets of a previous webview but stays usable", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "terminal-1" })
    await until(() => clients.length === 1)

    test.relay.reset()
    await until(() => clients.length === 0)

    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s2", terminalId: "terminal-1" })
    await until(() => clients.length === 1)
    expect(test.tickets).toEqual(["ticket-1-pty-1", "ticket-2-pty-1"])
    test.relay.dispose()
  })

  it("mints a fresh ticket for every socket open", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "a", terminalId: "terminal-1" })
    await until(() => clients.length === 1)
    post(test.relay, { type: "agentManager.terminal.socket.close", socketId: "a" })
    await until(() => clients.length === 0)

    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "b", terminalId: "terminal-1" })
    await until(() => clients.length === 1)
    expect(test.tickets).toEqual(["ticket-1-pty-1", "ticket-2-pty-1"])
    test.relay.dispose()
  })

  it("reports an unavailable terminal without opening a socket", async () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.open", socketId: "s1", terminalId: "missing" })
    await wait()
    expect(test.messages).toEqual([
      { type: "agentManager.terminal.socket.closed", socketId: "s1", code: 4404, reason: "Terminal is not available" },
    ])
    expect(test.tickets).toEqual([])
  })

  it("ignores send and close for unknown sockets and does not handle other messages", () => {
    const test = harness()
    post(test.relay, { type: "agentManager.terminal.socket.send", socketId: "missing", data: "x" })
    post(test.relay, { type: "agentManager.terminal.socket.close", socketId: "missing" })
    expect(test.messages).toEqual([])
    expect(test.relay.handle({ type: "agentManager.terminal.resize", terminalId: "s1", cols: 80, rows: 24 })).toBe(false)
  })
})