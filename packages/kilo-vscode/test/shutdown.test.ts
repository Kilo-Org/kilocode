import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import type { Server } from "../src/server"
import { createShutdown } from "../src/shutdown"

const calls: string[] = []
const state = { active: {} as Record<string, unknown>, delay: 0 }

const http = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    calls.push(`${request.method} ${url.pathname}`)
    if (state.delay) await Bun.sleep(state.delay)
    if (url.pathname === "/api/session/active")
      return new Response(JSON.stringify({ data: state.active }), { headers: { "content-type": "application/json" } })
    if (url.pathname.endsWith("/interrupt"))
      return new Response(JSON.stringify({ interrupted: true }), { headers: { "content-type": "application/json" } })
    return new Response("not found", { status: 404 })
  },
})

afterAll(() => http.stop(true))

beforeEach(() => {
  calls.length = 0
  state.active = {}
  state.delay = 0
})

const server = { url: `http://127.0.0.1:${http.port}`, authorization: "Basic test" } as Server

describe("createShutdown", () => {
  test("interrupts every active session before it stops the server", async () => {
    state.active = { ses_a: { since: 1 }, ses_b: { since: 2 } }
    const shutdown = createShutdown()
    shutdown.started(server)
    await shutdown.run(async () => {
      calls.push("stop")
    })
    expect(calls[0]).toBe("GET /api/session/active")
    expect(calls.slice(1, 3).toSorted()).toEqual(["POST /api/session/ses_a/interrupt", "POST /api/session/ses_b/interrupt"])
    expect(calls.at(-1)).toBe("stop")
  })

  test("only stops when no server runs", async () => {
    const shutdown = createShutdown()
    shutdown.started(server)
    shutdown.stopped()
    await shutdown.run(async () => {
      calls.push("stop")
    })
    expect(calls).toEqual(["stop"])
  })

  test("stops after the limit when the server does not answer", async () => {
    state.delay = 500
    const shutdown = createShutdown({ limit: 50 })
    shutdown.started(server)
    const started = Date.now()
    await shutdown.run(async () => {
      calls.push("stop")
    })
    expect(Date.now() - started).toBeLessThan(400)
    expect(calls.at(-1)).toBe("stop")
  })
})
