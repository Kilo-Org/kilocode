import { expect, spyOn, test } from "bun:test"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { KiloShutdown } from "../../../src/kilocode/cli/shutdown"

test("KiloSessions drains queued ingest before instance disposal", async () => {
  const token = process.env.KILO_API_KEY
  const base = process.env.KILO_SESSION_INGEST_URL
  const calls: string[] = []
  let body: unknown
  process.env.KILO_API_KEY = "shutdown-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.test"
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  clearInFlightCache("kilo-sessions:token-valid:shutdown-token")
  await KiloShutdown.run()

  const request = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
        if (url.endsWith("/api/session")) {
          return Response.json({ id: "remote-shutdown", ingestPath: "/api/ingest/shutdown" })
        }
        if (url.endsWith("/api/ingest/shutdown?v=2")) {
          body = init?.body ? JSON.parse(String(init.body)) : undefined
          calls.push("ingest")
          return new Response("{}", { status: 200 })
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )

  try {
    const url = new URL("../../../src/kilo-sessions/kilo-sessions.ts", import.meta.url)
    url.searchParams.set("test", crypto.randomUUID())
    const { KiloSessions } = await import(url.href)
    await KiloSessions.bootstrap("session-shutdown")
    expect(await KiloSessions._queueIngestForTest("session-shutdown")).toBe(true)

    await KiloShutdown.run()
    calls.push("dispose")

    expect(calls).toEqual(["ingest", "dispose"])
    expect(body).toEqual({ data: [{ type: "session_status", data: { status: "idle" } }] })
  } finally {
    request.mockRestore()
    if (token === undefined) delete process.env.KILO_API_KEY
    else process.env.KILO_API_KEY = token
    if (base === undefined) delete process.env.KILO_SESSION_INGEST_URL
    else process.env.KILO_SESSION_INGEST_URL = base
    clearInFlightCache("kilo-sessions:token")
    clearInFlightCache("kilo-sessions:client")
    clearInFlightCache("kilo-sessions:token-valid:shutdown-token")
    await KiloShutdown.run()
  }
}, 30_000)
