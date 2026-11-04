import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { broker, destination, openPage, takeBroker } from "../src/browser"

// The tool's only host is the extension-owned browser broker, so this test serves the two routes it uses instead of
// mocking the client. That keeps the request shape, the bearer token and the decoded state under test.
describe("browser_open broker endpoint", () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  function configure(url: string | undefined, token = "secret") {
    if (url === undefined) {
      delete process.env.KILO_BROWSER_BROKER_URL
      delete process.env.KILO_BROWSER_BROKER_TOKEN
      return
    }
    process.env.KILO_BROWSER_BROKER_URL = url
    process.env.KILO_BROWSER_BROKER_TOKEN = token
  }

  test("accepts the loopback origin the host serves", () => {
    configure("http://127.0.0.1:41234")
    expect(broker()).toEqual({ url: new URL("http://127.0.0.1:41234"), token: "secret" })
  })

  test("removes the capability from the process environment once it is read", () => {
    configure("http://127.0.0.1:41234")
    expect(takeBroker()).toEqual({ url: new URL("http://127.0.0.1:41234"), token: "secret" })
    expect(process.env.KILO_BROWSER_BROKER_URL).toBeUndefined()
    expect(process.env.KILO_BROWSER_BROKER_TOKEN).toBeUndefined()
    expect(broker()).toBeUndefined()
  })

  test("is absent without both values", () => {
    configure(undefined)
    expect(broker()).toBeUndefined()
    configure("http://127.0.0.1:41234")
    delete process.env.KILO_BROWSER_BROKER_TOKEN
    expect(broker()).toBeUndefined()
  })

  test.each([
    "http://localhost:41234",
    "https://127.0.0.1:41234",
    "http://127.0.0.1:41234/browser",
    "http://127.0.0.1:41234?x=1",
    "http://user:pass@127.0.0.1:41234",
    "not a url",
  ])("rejects %s", (value) => {
    configure(value)
    expect(broker()).toBeUndefined()
  })
})

function href(value: string): string {
  const target = destination(value)
  if (!target || "error" in target) throw new Error(`Expected a valid destination for ${value}`)
  return target.url.href
}

describe("browser_open destination", () => {
  test("accepts public HTTPS and loopback HTTP", () => {
    expect(href("https://example.com/docs")).toBe("https://example.com/docs")
    expect(href("http://localhost:3000/app")).toBe("http://localhost:3000/app")
    expect(href("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/")
  })

  test("opens 0.0.0.0 as localhost", () => {
    expect(href("http://0.0.0.0:3000/")).toBe("http://localhost:3000/")
  })

  test.each(["ftp://example.com/file", "file:///tmp/page.html", "http://example.com/", "not a url"])(
    "rejects %s",
    (value) => {
      expect(destination(value)).toHaveProperty("error")
    },
  )

  test("rejects the loopback URLs the broker refuses", () => {
    expect(destination("https://localhost/")).toHaveProperty("error")
    expect(destination("https://127.0.0.1/")).toHaveProperty("error")
    expect(destination("https://app.localhost/")).toHaveProperty("error")
    expect(destination("http://localhost:0/")).toHaveProperty("error")
  })

  test("rejects credentials", () => {
    expect(destination("https://user:pass@example.com/")).toHaveProperty("error")
    expect(destination("http://user:pass@localhost:3000/")).toHaveProperty("error")
  })
})

describe("browser_open request", () => {
  let http: ReturnType<typeof Bun.serve>
  let received: { authorization?: string; body?: unknown } = {}

  beforeEach(() => {
    received = {}
    http = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/browser/open") return new Response(null, { status: 404 })
        received = { authorization: request.headers.get("authorization") ?? undefined, body: await request.json() }
        return Response.json({
          browserId: "browser",
          sessionId: "session",
          status: "ready",
          url: "http://localhost:3000/",
          title: "Application",
          errors: 1,
          logs: ["[error] missing favicon"],
        })
      },
    })
  })

  afterEach(() => {
    http.stop(true)
  })

  test("sends the session, directory and URL with the broker token", async () => {
    const origin = new URL(http.url.origin)
    const state = await openPage({
      broker: { url: origin, token: "secret" },
      directory: "/repo",
      sessionID: "session",
      url: new URL("http://localhost:3000/"),
    })
    expect(received.authorization).toBe("Bearer secret")
    expect(received.body).toEqual({
      sessionID: "session",
      directory: "/repo",
      url: "http://localhost:3000/",
      capture: false,
    })
    expect(state.title).toBe("Application")
    expect(state.errors).toBe(1)
  })

  test("surfaces the broker error text", async () => {
    http.stop(true)
    http = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return Response.json({ error: "Cannot connect to http://localhost:31847/." }, { status: 400 })
      },
    })
    await expect(
      openPage({
        broker: { url: new URL(http.url.origin), token: "secret" },
        directory: "/repo",
        sessionID: "session",
        url: new URL("http://localhost:31847/"),
      }),
    ).rejects.toThrow("Cannot connect to http://localhost:31847/.")
  })
})