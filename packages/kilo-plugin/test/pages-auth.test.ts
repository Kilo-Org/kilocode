import { afterEach, expect, test } from "bun:test"
import { PagesAuth } from "../src/pages/auth"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((fn) => fn()))

function server(respond: (request: Request, count: number) => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers; body: string }[] = []
  const http = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ url: request.url, headers: request.headers, body: await request.text() })
      return respond(request, requests.length)
    },
  })
  cleanup.push(() => void http.stop(true))
  return { requests, origin: `http://localhost:${http.port}` }
}

// The transport the wrapper sits on: a real fetch that follows nothing it was not asked to.
const base = (url: string | URL, init?: RequestInit) => fetch(url, init)

function bind(origin: string, tokens: (string | undefined)[]) {
  const handle = crypto.randomUUID()
  const asked: (string | undefined)[] = []
  cleanup.push(
    PagesAuth.register(handle, {
      origin,
      client: "kilo/test",
      token: async (rejected) => {
        asked.push(rejected)
        return tokens.shift()
      },
    }),
  )
  return { handle, asked }
}

const call = (handle: string, url: string, init: RequestInit = {}) =>
  PagesAuth.wrap(base)(url, { ...init, headers: { [PagesAuth.HANDLE_HEADER]: handle, ...init.headers } })

test("a request without the handle is not touched", async () => {
  const pages = server(() => new Response("ok"))
  const response = await PagesAuth.wrap(base)(`${pages.origin}/mcp`, { headers: { "x-other": "1" } })
  expect(await response.text()).toBe("ok")
  expect(pages.requests[0]!.headers.get("authorization")).toBeNull()
  expect(pages.requests[0]!.headers.get("x-other")).toBe("1")
})

test("adds the bearer and client headers, and strips the handle", async () => {
  const pages = server(() => new Response("ok"))
  const { handle } = bind(pages.origin, ["tok-1"])
  const body = JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "x" } })
  const response = await call(handle, `${pages.origin}/mcp`, { method: "POST", body })
  expect(response.status).toBe(200)
  const sent = pages.requests[0]!.headers
  expect(sent.get("authorization")).toBe("Bearer tok-1")
  expect(sent.get("x-pages-driver")).toBe("Kilo")
  expect(sent.get("x-pages-client")).toBe("kilo/test")
  expect(sent.get(PagesAuth.HANDLE_HEADER)).toBeNull()
})

test("never sends the token to another origin", async () => {
  const pages = server(() => new Response("ok"))
  const other = server(() => new Response("leak"))
  const { handle, asked } = bind(pages.origin, ["tok-1"])
  const response = await call(handle, `${other.origin}/mcp`)
  expect(response.status).toBe(401)
  expect(other.requests).toHaveLength(0)
  expect(asked).toEqual([])
})

test("a redirect is returned to the caller, not followed with the token", async () => {
  const other = server(() => new Response("leak"))
  const pages = server(() => Response.redirect(`${other.origin}/steal`, 307))
  const { handle } = bind(pages.origin, ["tok-1"])
  const response = await call(handle, `${pages.origin}/mcp`)
  expect(response.status).toBe(307)
  expect(other.requests).toHaveLength(0)
})

test("a user's own Authorization is left alone", async () => {
  const pages = server(() => new Response("ok"))
  const { handle, asked } = bind(pages.origin, ["tok-1"])
  await call(handle, `${pages.origin}/mcp`, { headers: { Authorization: "Bearer user" } })
  expect(pages.requests[0]!.headers.get("authorization")).toBe("Bearer user")
  expect(asked).toEqual([])
})

test("retries once on a 401 with a fresh token", async () => {
  const pages = server((request) => (request.headers.get("authorization") === "Bearer tok-2" ? new Response("ok") : new Response("no", { status: 401 })))
  const { handle, asked } = bind(pages.origin, ["tok-1", "tok-2"])
  const response = await call(handle, `${pages.origin}/mcp`, { method: "POST", body: "{}" })
  expect(response.status).toBe(200)
  expect(pages.requests.map((item) => item.headers.get("authorization"))).toEqual(["Bearer tok-1", "Bearer tok-2"])
  expect(asked).toEqual([undefined, "tok-1"])
})

test("a persistent 401 stops after one retry with a fixed body", async () => {
  const pages = server(() => new Response("secret detail from pages", { status: 401 }))
  const { handle } = bind(pages.origin, ["tok-1", "tok-2"])
  const response = await call(handle, `${pages.origin}/mcp`, { method: "POST", body: "{}" })
  expect(response.status).toBe(401)
  expect(await response.text()).toBe("Pages rejected the Kilo credential")
  expect(pages.requests).toHaveLength(2)
})

test("no token or no binding is a 401 with no network call", async () => {
  const pages = server(() => new Response("ok"))
  const { handle } = bind(pages.origin, [])
  expect((await call(handle, `${pages.origin}/mcp`)).status).toBe(401)
  expect((await call("unknown", `${pages.origin}/mcp`)).status).toBe(401)
  expect(pages.requests).toHaveLength(0)
})
