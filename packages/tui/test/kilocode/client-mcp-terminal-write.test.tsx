/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { testRender } from "@opentui/solid"
import { createSignal, onCleanup, Show } from "solid-js"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { useSessionTerminals, SessionTerminalsProvider } from "../../src/context/session-terminals"
import { ClientProvider } from "../../src/context/client"
import { ClientMcp } from "../../src/context/client-mcp"
import { DataProvider } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider } from "../../src/context/route"
import { SessionTabsProvider } from "../../src/context/session-tabs"
import { ConfigProvider } from "../../src/config"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"

test("terminal writes fail after the input writer detaches", async () => {
  await using state = await tmpdir()
  const events = createEventStream()
  const input: Uint8Array[] = []
  const fetch = createFetch(undefined, events)
  const [attached, setAttached] = createSignal(true)
  let terminals!: ReturnType<typeof useSessionTerminals>
  function Writer() {
    onCleanup(terminals.attachWriter("pty_fixture", (data) => input.push(data)))
    return null
  }
  function Probe() {
    terminals = useSessionTerminals()
    return (
      <Show when={attached()}>
        <Writer />
      </Show>
    )
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: state.path }}>
      <TuiAppProvider
        value={{ name: "test", version: "test", channel: "test", capabilities: { terminalInput: "attached-only" } }}
      >
        <StorageProvider>
          <ClientProvider api={createApi(fetch.fetch)}>
            <DataProvider directory={directory}>
              <SessionTerminalsProvider>
                <Probe />
              </SessionTerminalsProvider>
            </DataProvider>
          </ClientProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))
  expect(terminals.write("pty_fixture", new TextEncoder().encode("before"))).toBe(true)
  expect(input).toHaveLength(1)
  setAttached(false)
  expect(terminals.write("pty_fixture", new TextEncoder().encode("after"))).toBe(false)
  expect(input).toHaveLength(1)
  setAttached(true)
  expect(input).toHaveLength(1)
  app.renderer.destroy()
  events.disconnect()
})

test("client MCP rejects fresh and detached terminal writes without replaying them", async () => {
  await using fixture = await terminalMcp("attached-only")
  const failure = {
    content: [{ type: "text", text: "Terminal is not attached; select the session's terminal pane and try again" }],
    isError: true,
  }
  const success = { content: [{ type: "text", text: "Wrote to terminal pty_fresh" }] }

  expect(await fixture.write("fresh\n")).toEqual(failure)
  expect(fixture.created()).toBe(1)
  const input: string[] = []
  const detach = fixture.terminals.attachWriter("pty_fresh", (data) => input.push(new TextDecoder().decode(data)))
  expect(input).toEqual([])
  expect(await fixture.write("attached\n")).toEqual(success)
  expect(input).toEqual(["attached\n"])
  const replacement: string[] = []
  const detachReplacement = fixture.terminals.attachWriter("pty_fresh", (data) =>
    replacement.push(new TextDecoder().decode(data)),
  )
  detach()
  expect(await fixture.write("replacement\n")).toEqual(success)
  expect(replacement).toEqual(["replacement\n"])
  detachReplacement()
  expect(await fixture.write("detached\n")).toEqual(failure)
  const later: string[] = []
  const detachLater = fixture.terminals.attachWriter("pty_fresh", (data) => later.push(new TextDecoder().decode(data)))
  expect(later).toEqual([])
  expect(await fixture.write("reattached\n")).toEqual(success)
  expect(later).toEqual(["reattached\n"])
  detachLater()
})

test.each([undefined, "queue"] as const)("client MCP queues terminal input in order (%s)", async (terminalInput) => {
  await using fixture = await terminalMcp(terminalInput)
  const success = { content: [{ type: "text", text: "Wrote to terminal pty_fresh" }] }
  const encoder = new TextEncoder()
  expect(await fixture.write("first\n")).toEqual(success)
  expect(await fixture.write("second\n")).toEqual(success)
  expect(fixture.created()).toBe(1)
  expect(fixture.terminals.write("pty_other", encoder.encode("other first"))).toBeUndefined()
  expect(fixture.terminals.write("pty_other", encoder.encode("other second"))).toBeUndefined()
  const input: string[] = []
  const detach = fixture.terminals.attachWriter("pty_fresh", (data) => input.push(new TextDecoder().decode(data)))
  expect(input).toEqual(["first\n", "second\n"])
  const other: string[] = []
  const detachOther = fixture.terminals.attachWriter("pty_other", (data) => other.push(new TextDecoder().decode(data)))
  expect(other).toEqual(["other first", "other second"])
  expect(await fixture.write("attached\n")).toEqual(success)
  expect(input).toEqual(["first\n", "second\n", "attached\n"])
  const replacement: string[] = []
  const detachReplacement = fixture.terminals.attachWriter("pty_fresh", (data) => {
    replacement.push(new TextDecoder().decode(data))
    return false
  })
  detach()
  expect(fixture.terminals.write("pty_fresh", encoder.encode("direct"))).toBe(false)
  expect(await fixture.write("replacement\n")).toEqual(success)
  expect(replacement).toEqual(["direct", "replacement\n"])
  detachReplacement()
  detachOther()
  expect(await fixture.write("after first\n")).toEqual(success)
  expect(await fixture.write("after second\n")).toEqual(success)
  const later: string[] = []
  const detachLater = fixture.terminals.attachWriter("pty_fresh", (data) => later.push(new TextDecoder().decode(data)))
  expect(later).toEqual(["after first\n", "after second\n"])
  detachLater()
})

async function terminalMcp(terminalInput?: "queue" | "attached-only") {
  const state = await tmpdir()
  const events = createEventStream()
  const sessionID = "ses_terminal_input"
  const terminal = {
    id: "pty_fresh",
    sessionID,
    title: "Terminal",
    cwd: directory,
    size: { rows: 24, columns: 80 },
    status: "running",
    time: { created: 1 },
  }
  let created = 0
  const fetch = createFetch((url, request) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          location: { directory },
          title: "Terminal input",
          time: { created: 1, updated: 1 },
        },
      })
    if (url.pathname !== `/api/experimental/session/${sessionID}/terminal`) return
    if (request.method === "GET") return json({ data: created ? [terminal] : [] })
    if (request.method === "POST") {
      created++
      return json({ data: terminal })
    }
  }, events)
  const ready = Promise.withResolvers<ServerWebSocket<unknown>>()
  const pending = new Map<number, (value: unknown) => void>()
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/api/experimental/client-mcp" && server.upgrade(request)) return
      return new Response(null, { status: 404 })
    },
    websocket: {
      open(socket) {
        ready.resolve(socket)
      },
      message(_socket, text) {
        const message = JSON.parse(String(text)) as { id?: number; result?: unknown }
        if (typeof message.id !== "number") return
        pending.get(message.id)?.(message.result)
        pending.delete(message.id)
      },
    },
  })
  let terminals!: ReturnType<typeof useSessionTerminals>
  function Probe() {
    terminals = useSessionTerminals()
    return <ClientMcp />
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: state.path }}>
      <TuiAppProvider
        value={{
          name: "test",
          version: "test",
          channel: "test",
          ...(terminalInput ? { capabilities: { terminalInput } } : {}),
        }}
      >
        <StorageProvider>
          <ConfigProvider
            config={createTuiResolvedConfig({ tabs: { mode: "off" }, experimental: { "client-mcp": true } })}
          >
            <RouteProvider initialRoute={{ type: "session", sessionID }}>
              <ClientProvider api={createApi(fetch.fetch)} url={server.url.toString()}>
                <DataProvider directory={directory}>
                  <LocationProvider>
                    <SessionTabsProvider>
                      <SessionTerminalsProvider>
                        <Probe />
                      </SessionTerminalsProvider>
                    </SessionTabsProvider>
                  </LocationProvider>
                </DataProvider>
              </ClientProvider>
            </RouteProvider>
          </ConfigProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))
  const peer = await ready.promise
  let id = 0
  const request = (method: string, params: unknown) => {
    const reply = Promise.withResolvers<unknown>()
    pending.set(++id, reply.resolve)
    peer.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    return reply.promise
  }
  expect(await request("initialize", { protocolVersion: "2025-11-25" })).toMatchObject({
    protocolVersion: "2025-11-25",
  })
  peer.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))
  return {
    terminals,
    created: () => created,
    write: (text: unknown) =>
      request("tools/call", {
        name: "write_terminal",
        arguments: { text },
        _meta: { "ai.opencode/sessionID": sessionID },
      }),
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      events.disconnect()
      await server.stop(true)
      await state[Symbol.asyncDispose]()
    },
  }
}
