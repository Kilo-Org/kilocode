import { afterAll, expect, test } from "bun:test"
import { local } from "../src/local"

const gate = Promise.withResolvers<void>()
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/echo")
      return Response.json({ method: request.method, auth: request.headers.get("authorization"), body: await request.text() })
    if (url.pathname === "/empty") return new Response(null, { status: 204 })
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("data: 1\n\n"))
          await gate.promise
          controller.enqueue(new TextEncoder().encode("data: 2\n\n"))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})
afterAll(() => server.stop(true))

test("sends method, headers and body", async () => {
  const response = await local(`${server.url}echo`, { method: "POST", headers: { authorization: "Basic x" }, body: "hi" })
  expect(await response.json()).toEqual({ method: "POST", auth: "Basic x", body: "hi" })
})

test("returns no body for 204", async () => {
  const response = await local(`${server.url}empty`)
  expect(response.status).toBe(204)
  expect(response.body).toBeNull()
})

test("streams each chunk as it arrives", async () => {
  const response = await local(`${server.url}event`)
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n")
  gate.resolve()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 2\n\n")
  expect((await reader.read()).done).toBe(true)
})
