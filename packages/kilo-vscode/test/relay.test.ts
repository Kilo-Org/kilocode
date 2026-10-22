import { describe, expect, test } from "bun:test"
import { bridge } from "../src/relay"
import type { ToHost, ToWebview } from "../src/protocol"
import { transport } from "../webview-ui/src/v2/transport"

// Connects the webview transport to the host bridge in one process, with `server` as the upstream fetch.
function pair(server: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = []
  const host = bridge({
    target: async () => ({ url: "http://server", authorization: "Basic test" }),
    post: (message) => queueMicrotask(() => web.receive(message)),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      seen.push(request.clone())
      return server(request)
    }) as typeof fetch,
  })
  const web = transport((message) => queueMicrotask(() => host.receive(message)))
  return { fetch: web.fetch, seen }
}

describe("bridge", () => {
  test("sends method, path, body and the host credential", async () => {
    const link = pair(async (request) => Response.json({ echo: await request.json() }, { status: 201 }))
    const response = await link.fetch("http://kilo.invalid/api/session?limit=5", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "a" }),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ echo: { title: "a" } })
    expect(link.seen[0].url).toBe("http://server/api/session?limit=5")
    expect(link.seen[0].method).toBe("POST")
    expect(link.seen[0].headers.get("authorization")).toBe("Basic test")
  })

  test("streams a response chunk by chunk", async () => {
    const gate = Promise.withResolvers<void>()
    const link = pair(
      () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("data: 1\n\n"))
              await gate.promise
              controller.enqueue(new TextEncoder().encode("data: 2\n\n"))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const response = await link.fetch("http://kilo.invalid/api/event")
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("data: 1\n\n")
    gate.resolve()
    const second = await reader.read()
    expect(new TextDecoder().decode(second.value)).toBe("data: 2\n\n")
    expect((await reader.read()).done).toBe(true)
  })

  test("aborting the request aborts the server request", async () => {
    const aborted = Promise.withResolvers<void>()
    const link = pair((request) => {
      request.signal.addEventListener("abort", () => aborted.resolve())
      return new Response(new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array([1])) }))
    })
    const abort = new AbortController()
    const response = await link.fetch("http://kilo.invalid/api/event", { signal: abort.signal })
    const reader = response.body!.getReader()
    await reader.read()
    abort.abort()
    await aborted.promise
    await expect(reader.read()).rejects.toThrow()
  })

  test("reports a failed server request as a fetch error", async () => {
    const host = bridge({
      target: () => Promise.reject(new Error("server did not start")),
      post: (message) => queueMicrotask(() => web.receive(message)),
    })
    const web = transport((message: ToHost) => queueMicrotask(() => host.receive(message)))
    await expect(web.fetch("http://kilo.invalid/api/info")).rejects.toThrow("server did not start")
  })

  test("ignores messages for unknown requests", () => {
    const web = transport(() => {})
    const stray: ToWebview = { type: "chunk", id: 99, data: new Uint8Array() }
    expect(() => web.receive(stray)).not.toThrow()
  })
})
