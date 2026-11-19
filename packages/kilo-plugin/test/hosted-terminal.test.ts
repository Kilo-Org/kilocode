import { expect, jest, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import { createTerminals } from "../src/hosted/terminal"

const target = { scope: "account", providerID: "kilo-cloud", workspaceID: "workspace", sessionID: "root" } as const
const open = { target, cols: 80, rows: 24 }

function worker() {
  const connected = Promise.withResolvers<Bun.ServerWebSocket<undefined>>()
  const released = Promise.withResolvers<unknown>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const path = new URL(request.url).pathname
      if (path === "/terminal" && server.upgrade(request)) return
      if (path === "/api/trpc/cloudAgentNext.createTerminal") {
        const data = { ptyId: "shell", wsUrl: "/terminal?ptyId=shell&cloudAgentSessionId=control&ticket=fixture" }
        return Response.json({ result: { data } })
      }
      if (path !== "/api/trpc/cloudAgentNext.closeTerminal") return new Response(null, { status: 404 })
      released.resolve(await request.json())
      return Response.json({ result: { data: {} } })
    },
    websocket: {
      // A pong proves the handshake finished without leaving an application frame for read().
      open: (socket) => {
        socket.ping("ready")
      },
      pong: (socket) => connected.resolve(socket),
      message() {},
    },
  })
  const life = new AbortController()
  const terminals = createTerminals(
    KiloAccount.resolve({ token: "fixture" }, {}),
    { issuer: server.url.origin, worker: server.url.origin },
    async () => "control",
    life.signal,
  )
  return {
    terminals,
    signal: life.signal,
    connected: connected.promise,
    released: released.promise,
    [Symbol.dispose]() {
      life.abort()
      void server.stop(true)
    },
  }
}

test("an already-open quiet shell reports open immediately, then uses bounded long polls", async () => {
  using w = worker()
  const input = { target, ...(await w.terminals.open(open, w.signal)) }
  await w.connected
  jest.useFakeTimers()
  try {
    const page = { state: "open" as const, frames: [] }
    // The first read must not depend on advancing a timer.
    expect(await Promise.race([w.terminals.read(input, w.signal), Promise.resolve("waiting")])).toEqual(page)
    const idle = w.terminals.read(input, w.signal)
    jest.advanceTimersByTime(1_000)
    await Promise.resolve()
    expect(await Promise.race([idle, Promise.resolve("waiting")])).toBe("waiting")
    jest.advanceTimersByTime(14_000)
    expect(await idle).toEqual(page)
  } finally {
    jest.useRealTimers()
  }
  w.terminals.close(input)
  expect(await w.released).toEqual({ cloudAgentSessionId: "control", ptyId: "shell" })
})

test("only the matching target can close the shell, waking pending reads and releasing its PTY", async () => {
  using w = worker()
  const input = { target, ...(await w.terminals.open(open, w.signal)) }
  await w.connected
  await w.terminals.read(input, w.signal)
  const canceled = new AbortController()
  const canceledRead = w.terminals.read(input, canceled.signal)
  const pending = w.terminals.read(input, w.signal)
  canceled.abort(new Error("read canceled"))
  await expect(canceledRead).rejects.toThrow("read canceled")
  expect(() => w.terminals.close({ ...input, target: { ...target, scope: "other" } })).toThrow("closed")
  w.terminals.close(input)
  expect(await pending).toEqual({ state: "closed", frames: [] })
  await expect(w.terminals.read(input, w.signal)).rejects.toThrow("closed")
  expect(await w.released).toEqual({ cloudAgentSessionId: "control", ptyId: "shell" })
})

test.each(["exit", "drop"])("a worker %s wakes a pending read", async (event) => {
  using w = worker()
  const input = { target, ...(await w.terminals.open(open, w.signal)) }
  const handshake = w.terminals.read(input, w.signal)
  const socket = await w.connected
  expect(await handshake).toEqual({ state: "open", frames: [] })
  const output = w.terminals.read(input, w.signal)
  socket.send("last line\r\n")
  expect(await output).toEqual({ state: "open", frames: [{ binary: false, data: "last line\r\n" }] })
  const pending = w.terminals.read(input, w.signal)
  if (event === "exit") socket.close(1000)
  else socket.terminate()
  expect(await pending).toEqual({ state: "closed", frames: [] })
  w.terminals.close(input)
  expect(await w.released).toEqual({ cloudAgentSessionId: "control", ptyId: "shell" })
})

test("a sleeping or unprepared route fails without waking the sandbox or exposing the worker's error details", async () => {
  const sleeping = "The sandbox is sleeping. Send a message to resume."
  let message = sleeping
  const calls: string[] = []
  using issuer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      calls.push(new URL(request.url).pathname)
      return Response.json({ error: { message, data: { code: "PRECONDITION_FAILED" } } }, { status: 412 })
    },
  })
  const signal = new AbortController().signal
  const terminals = createTerminals(
    KiloAccount.resolve({ token: "fixture" }, {}),
    { issuer: issuer.url.origin, worker: "https://worker.invalid" },
    async () => "control",
    signal,
  )
  await expect(terminals.open(open, signal)).rejects.toThrow(sleeping)
  message = "unprepared: private worker details"
  await expect(terminals.open(open, signal)).rejects.toThrow(
    /^The Cloud terminal will be available when the workspace is running and ready\.$/,
  )
  expect(calls).toEqual(Array(2).fill("/api/trpc/cloudAgentNext.createTerminal"))
})
