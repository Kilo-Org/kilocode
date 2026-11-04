import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { createAgentManagerConnection, located } from "../src/agent-manager/connection"
import type { Manager, Server } from "../src/server"

const AUTHORIZATION = "Basic test"
const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const calls: { path: string; authorization: string | null; body?: string }[] = []
const sessions = new Map<string, { idle?: number; viewed?: number }>()

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

const http = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const body = request.method === "POST" ? await request.text() : undefined
    calls.push({ path: url.pathname, authorization: request.headers.get("authorization"), body })
    if (url.pathname === "/api/event") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          controller.enqueue(encoder.encode(frame({ type: "server.connected", id: "evt_0", created: 0, data: {} })))
        },
        cancel() {
          streams.clear()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream" } })
    }
    const view = /^\/api\/session\/([^/]+)\/view$/.exec(url.pathname)
    if (view) return new Response(null, { status: 204 })
    const get = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    const time = get ? sessions.get(get[1]!) : undefined
    if (get && time)
      return json({
        data: {
          id: get[1],
          projectID: "prj_1",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1, ...time },
          location: { directory: "/repo" },
        },
      })
    return new Response(JSON.stringify({ _tag: "NotFound", message: "not found" }), { status: 404 })
  },
})

afterAll(() => http.stop(true))

function frame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function emit(event: unknown) {
  streams.forEach((controller) => controller.enqueue(encoder.encode(frame(event))))
}

function end() {
  streams.forEach((controller) => controller.close())
  streams.clear()
}

const server = { url: `http://127.0.0.1:${http.port}`, authorization: AUTHORIZATION } as Server
const manager = { get: async () => server } as unknown as Manager

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(20)
  }
  throw new Error("condition not reached")
}

const event = (type: string, directory: string | undefined, data: Record<string, unknown> = {}) => ({
  id: `evt_${type}`,
  created: 1,
  type,
  location: directory ? { directory } : undefined,
  data,
})

beforeEach(() => {
  calls.length = 0
  sessions.clear()
  end()
})

describe("createAgentManagerConnection", () => {
  test("starts disconnected and connects when the server starts", async () => {
    const connection = createAgentManagerConnection({ server: manager })
    const seen: string[] = []
    connection.onState((status) => seen.push(status))
    expect(connection.state()).toBe("disconnected")
    expect(connection.current()).toBeUndefined()
    connection.started(server)
    await until(() => connection.state() === "connected")
    expect(seen).toEqual(["connecting", "connected"])
    expect(connection.current()).toBeDefined()
    expect(connection.server()).toEqual({ url: server.url, authorization: AUTHORIZATION })
    expect(calls.find((call) => call.path === "/api/event")?.authorization).toBe(AUTHORIZATION)
    connection.stopped()
    expect(connection.state()).toBe("disconnected")
    expect(connection.current()).toBeUndefined()
    expect(connection.server()).toBeUndefined()
    connection.dispose()
  })

  test("delivers events through each listener filter", async () => {
    const connection = createAgentManagerConnection({ server: manager })
    const all: string[] = []
    const scoped: string[] = []
    connection.onEvent((item) => all.push(item.type))
    connection.onEvent((item) => scoped.push(`${item.type}:${item.location?.directory ?? ""}`), located(() => ["/repo"]))
    connection.started(server)
    await until(() => connection.state() === "connected")
    emit(event("pty.exited", "/repo", { id: "pty_1" }))
    emit(event("pty.exited", "/other", { id: "pty_2" }))
    emit(event("credential.updated", undefined))
    await until(() => all.length === 4)
    expect(all).toEqual(["server.connected", "pty.exited", "pty.exited", "credential.updated"])
    expect(scoped).toEqual(["server.connected:", "pty.exited:/repo", "credential.updated:"])
    connection.dispose()
  })

  test("subscribes again when the event stream ends", async () => {
    const connection = createAgentManagerConnection({ server: manager, reconnect: 10 })
    connection.started(server)
    await until(() => connection.state() === "connected")
    end()
    await until(() => calls.filter((call) => call.path === "/api/event").length === 2 && connection.state() === "connected")
    connection.dispose()
  })

  test("marks the idle transition of a visible session as viewed once", async () => {
    sessions.set("ses_idle", { idle: 50 })
    sessions.set("ses_viewed", { idle: 50, viewed: 50 })
    sessions.set("ses_busy", {})
    const connection = createAgentManagerConnection({ server: manager })
    connection.started(server)
    await until(() => connection.state() === "connected")
    connection.view(["ses_idle", "ses_viewed", "ses_busy"])
    await until(() => calls.filter((call) => call.path.startsWith("/api/session/")).length >= 4)
    const views = () => calls.filter((call) => call.path.endsWith("/view"))
    expect(views().map((call) => [call.path, call.body])).toEqual([["/api/session/ses_idle/view", '{"idle":50}']])

    // A later idle transition of a visible session is marked too; a hidden session is not.
    sessions.set("ses_busy", { idle: 70 })
    sessions.set("ses_hidden", { idle: 70 })
    emit(event("session.idle", "/repo", { sessionID: "ses_busy" }))
    emit(event("session.idle", "/repo", { sessionID: "ses_hidden" }))
    await until(() => views().length === 2)
    expect(views()[1]?.path).toBe("/api/session/ses_busy/view")
    expect(calls.some((call) => call.path === "/api/session/ses_hidden")).toBe(false)
    connection.dispose()
  })
})

