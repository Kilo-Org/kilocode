import { afterEach, describe, expect, test } from "bun:test"
import { createServer, request, type IncomingMessage } from "node:http"
import { connect } from "node:net"
import { PassThrough } from "node:stream"
import { runInNewContext } from "node:vm"
import WebSocket, { WebSocketServer } from "ws"
import { BrowserBroker, diagnostic } from "../../src/services/browser-automation/browser-broker"
import { BrowserDevtools } from "../../src/services/browser-automation/browser-devtools"

const brokers: BrowserBroker[] = []

function fixture<T>(page: T) {
  const broker = new BrowserBroker({
    log: () => {},
    launch: async () => ({
      newContext: async () => ({
        close: async () => undefined,
        route: async () => undefined,
        routeWebSocket: async () => undefined,
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  })
  brokers.push(broker)
  return broker
}

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.disposeAsync()))
})

describe("BrowserBroker", () => {
  test("accepts only HTTP loopback URLs", () => {
    const broker = new BrowserBroker({ log: () => {} })
    expect(broker.validate("http://localhost:3000/path").origin).toBe("http://localhost:3000")
    expect(() => broker.validate("https://localhost:3000")).toThrow()
    expect(() => broker.validate("http://127.0.0.1:3000")).not.toThrow()
    expect(() => broker.validate("http://[::1]:3000")).toThrow("Use localhost for IPv6 loopback servers")
    expect(() => broker.validate("http://0.0.0.0:3000")).toThrow()
    expect(() => broker.validate("http://example.com")).toThrow()
    expect(() => broker.validate("http://username:password@localhost:3000")).toThrow()
    expect(() => broker.validate("file:///tmp/example.html")).toThrow()
  })

  test("normalizes browser failures without leaking Playwright call logs or ANSI formatting", () => {
    const refused = new Error(
      "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:31847/\nCall log:\n\u001b[2m- navigating\u001b[22m",
    )
    expect(diagnostic(refused, "http://localhost:31847/")).toBe(
      "Cannot connect to http://localhost:31847/. Make sure the local server is running.",
    )
    expect(diagnostic(new Error("page.goto: Timeout 30000ms exceeded"))).toBe(
      "The local application did not respond in time. Check the server and try again.",
    )
    expect(diagnostic(new Error("\u001b[31mpage.goto: Custom navigation failure\u001b[0m\nCall log:\n- details"))).toBe(
      "Custom navigation failure",
    )
  })

  test("sanitizes refused navigation errors in browser state and agent responses", async () => {
    const page = {
      url: () => "about:blank",
      title: async () => "",
      screenshot: async () => Buffer.from("jpeg"),
      on: (_type: string, _listener: (...args: never[]) => void) => undefined,
      mainFrame: () => undefined,
      goto: async () => {
        throw new Error("page.goto: net::ERR_CONNECTION_REFUSED\nCall log:\n\u001b[2m- navigating\u001b[22m")
      },
    }
    const broker = fixture(page)
    const env = await broker.env()
    const response = await fetch(`${env.KILO_BROWSER_BROKER_URL}/browser/open`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.KILO_BROWSER_BROKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionID: "refused", directory: "/tmp/project", url: "http://localhost:31847/" }),
    })
    const message = "Cannot connect to http://localhost:31847/. Make sure the local server is running."
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(broker.get("refused")?.error).toBe(message)
  })

  test("reloads repeated agent opens and returns fresh page diagnostics", async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const loading: number[] = []
    let version = 1
    const page = {
      url: () => "http://localhost:3000/",
      title: async () => `Application version ${version}`,
      screenshot: async () => Buffer.from(`version-${version}`),
      on: (type: string, listener: (value: unknown) => void) => {
        listeners.set(type, listener)
      },
      mainFrame: () => undefined,
      goto: async () => {
        listeners.get("console")?.({ type: () => "log", text: () => "STARTUP_VERSION_1" })
      },
      reload: async () => {
        version++
        listeners.get("console")?.({ type: () => "error", text: () => "STARTUP_VERSION_2" })
      },
    }
    const broker = fixture(page)
    broker.subscribe((state) => {
      if (state.status === "loading" && loading.at(-1) !== state.navigation) loading.push(state.navigation)
    })
    const env = await broker.env()
    const request = () =>
      fetch(`${env.KILO_BROWSER_BROKER_URL}/browser/open`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.KILO_BROWSER_BROKER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionID: "agent", directory: "/tmp/project", url: "http://localhost:3000/" }),
      }).then((response) => response.json() as Promise<{ navigation: number; title: string; logs: string[] }>)

    expect(await request()).toMatchObject({
      navigation: 1,
      title: "Application version 1",
      logs: ["[log] STARTUP_VERSION_1"],
    })
    expect(await request()).toMatchObject({
      navigation: 2,
      title: "Application version 2",
      logs: ["[error] STARTUP_VERSION_2"],
    })
    expect(loading).toEqual([1, 2])
  })

  test("protects its local bridge with a bearer token", async () => {
    const broker = new BrowserBroker({ log: () => {} })
    brokers.push(broker)
    const env = await broker.env()
    const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const url = new URL(`${env.KILO_BROWSER_BROKER_URL}/browser/state`)
      const req = request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(chunk))
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }))
      })
      req.on("error", reject)
      req.end("{}")
    })
    expect(result.status).toBe(401)
    expect(JSON.parse(result.body)).toEqual({ error: "Unauthorized" })
    const malformed = await fetch(`${env.KILO_BROWSER_BROKER_URL}/browser/status`, {
      headers: { authorization: `Bearer ${"é".repeat(64)}` },
    })
    expect(malformed.status).toBe(401)
  })

  test("reports experimental availability only to authenticated clients", async () => {
    let enabled = false
    let trusted = true
    const broker = new BrowserBroker({ log: () => {}, enabled: () => enabled, trusted: () => trusted })
    brokers.push(broker)
    const env = await broker.env()
    const headers = { authorization: `Bearer ${env.KILO_BROWSER_BROKER_TOKEN}` }
    const url = `${env.KILO_BROWSER_BROKER_URL}/browser/status`
    expect((await fetch(url)).status).toBe(401)
    expect(await (await fetch(url, { headers })).json()).toEqual({ enabled: false })
    enabled = true
    expect(await (await fetch(url, { headers })).json()).toEqual({ enabled: true })
    trusted = false
    expect(await (await fetch(url, { headers })).json()).toEqual({ enabled: false })
  })

  test("writes an explicit forbidden response before closing an untrusted upgrade", () => {
    const server = createServer()
    const tools = new BrowserDevtools(
      server,
      4567,
      () => {},
      () => {},
    )
    const url = new URL(tools.open("browser", "page", 1234, "dark"))
    const endpoint = new URL(`ws://${url.searchParams.get("ws")}`)
    const socket = new PassThrough()
    const chunks: Buffer[] = []
    socket.on("data", (chunk) => chunks.push(chunk))
    server.emit(
      "upgrade",
      {
        url: endpoint.pathname,
        headers: { host: "127.0.0.1:4567", origin: "http://untrusted.invalid" },
      } as IncomingMessage,
      socket,
      Buffer.alloc(0),
    )
    expect(Buffer.concat(chunks).toString()).toStartWith("HTTP/1.1 403 Forbidden\r\n")
    expect(socket.destroyed).toBe(true)
    tools.dispose()
  })

  test("proxies page-scoped developer tools and rejects invalid capabilities or origins", async () => {
    const remote = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname
      if (path === "/devtools/inspector.html") {
        res.writeHead(200, { "content-type": "text/html" })
        res.end('<script type="module" src="./entrypoints/inspector.js"></script>')
        return
      }
      if (path === "/devtools/entrypoints/inspector.js") {
        res.writeHead(200, { "content-type": "text/javascript" })
        res.end("globalThis.loaded = true")
        return
      }
      res.writeHead(404)
      res.end()
    })
    const websocket = new WebSocketServer({ server: remote })
    const routes: string[] = []
    const moves: Array<{ type: string; x?: number; y?: number }> = []
    websocket.on("connection", (socket, req) => {
      routes.push(req.url ?? "")
      socket.on("message", (value) => {
        const input = JSON.parse(value.toString()) as { id: number }
        socket.send(JSON.stringify({ id: input.id, result: { value: "selected page" } }))
      })
    })
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve))
    const address = remote.address()
    if (!address || typeof address === "string") throw new Error("Test browser did not receive a local port")
    let next = 0
    const browser = {
      debugging: address.port,
      newContext: async () => {
        const id = `target-${++next}`
        let viewport: { width: number; height: number } | undefined
        const page = {
          url: () => "http://localhost:3000/",
          title: async () => "Developer tools test",
          screenshot: async () => Buffer.from("jpeg"),
          on: (_type: string, _listener: (...args: never[]) => void) => undefined,
          mainFrame: () => undefined,
          goto: async () => undefined,
          viewportSize: () => viewport,
          setViewportSize: async (size: { width: number; height: number }) => {
            viewport = size
          },
          mouse: {
            move: async (x: number, y: number) => moves.push({ type: "move", x, y }),
            down: async () => moves.push({ type: "down" }),
            up: async () => {
              moves.push({ type: "up" })
              for (const client of websocket.clients) {
                client.send(JSON.stringify({ method: "Overlay.inspectNodeRequested", params: { backendNodeId: 42 } }))
              }
            },
          },
        }
        return {
          close: async () => undefined,
          route: async () => undefined,
          routeWebSocket: async () => undefined,
          newPage: async () => page,
          newCDPSession: async () => ({
            send: async () => ({ targetInfo: { targetId: id } }),
            detach: async () => undefined,
          }),
        }
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, launch: async () => browser })
    brokers.push(broker)
    try {
      const env = await broker.env()
      await broker.open(
        { projectId: "project", sessionId: "first", directory: "/tmp/project" },
        "http://localhost:3000",
      )
      await broker.open(
        { projectId: "project", sessionId: "second", directory: "/tmp/project" },
        "http://localhost:3000",
      )
      const first = await broker.devtools("first", "project")
      const second = await broker.devtools("second", "project", "light")
      expect(first.browserId).not.toBe(second.browserId)
      expect(first.url).not.toContain(env.KILO_BROWSER_BROKER_TOKEN)
      expect(new URL(first.url).searchParams.has("can_dock")).toBe(false)
      const frontend = await fetch(first.url)
      expect(frontend.status).toBe(200)
      expect(await frontend.text()).toContain('<script src="./kilo-bootstrap.js"></script>')
      for (const [entry, theme] of [
        [first, "dark"],
        [second, "light"],
      ] as const) {
        const bootstrap = await fetch(new URL("./kilo-bootstrap.js", entry.url))
        expect(bootstrap.status).toBe(200)
        const storage = new Map<string, string>()
        runInNewContext(await bootstrap.text(), {
          localStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
        })
        expect(storage.get("ui-theme")).toBe(JSON.stringify(theme))
        expect(storage.get("currentDockState")).toBe(JSON.stringify("undocked"))
      }
      expect((await fetch(new URL("./entrypoints/inspector.js", first.url))).status).toBe(200)

      const invalid = new URL(first.url)
      const parts = invalid.pathname.split("/")
      parts[4] = "0".repeat(64)
      invalid.pathname = parts.join("/")
      expect((await fetch(invalid)).status).toBe(401)

      const swapped = new URL(first.url)
      swapped.pathname = swapped.pathname.replace(first.browserId, second.browserId)
      expect((await fetch(swapped)).status).toBe(401)

      const endpoint = `ws://${new URL(first.url).searchParams.get("ws")}`
      const forbidden = await new Promise<number>((resolve, reject) => {
        const url = new URL(endpoint)
        const socket = connect({ host: url.hostname, port: Number(url.port) }, () => {
          socket.write(
            [
              `GET ${url.pathname} HTTP/1.1`,
              `Host: ${url.host}`,
              "Connection: Upgrade",
              "Upgrade: websocket",
              "Sec-WebSocket-Version: 13",
              `Sec-WebSocket-Key: ${Buffer.from("browser-test-key").toString("base64")}`,
              "Origin: http://untrusted.invalid",
              "\r\n",
            ].join("\r\n"),
          )
        })
        socket.once("data", (data) => {
          resolve(Number(data.toString().match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? 0))
          socket.end()
        })
        socket.once("end", () => resolve(0))
        socket.once("error", reject)
      })
      expect([0, 403]).toContain(forbidden)

      const socket = new WebSocket(endpoint, { headers: { origin: new URL(first.url).origin } })
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve)
        socket.once("error", reject)
      })
      socket.send(JSON.stringify({ id: 9, method: "Runtime.evaluate" }))
      const result = await new Promise<{ id: number; result: { value: string } }>((resolve) => {
        socket.once("message", (value) => resolve(JSON.parse(value.toString())))
      })
      expect(result).toEqual({ id: 9, result: { value: "selected page" } })
      expect(routes).toEqual(["/devtools/page/target-1"])
      await broker.input("first", "project", { x: 0.5, y: 0.25, width: 400, height: 240 }, false)
      expect(moves).toEqual([])

      socket.send(
        JSON.stringify({
          id: 10,
          method: "Overlay.setInspectMode",
          params: { mode: "searchForNode", highlightConfig: { showInfo: true } },
        }),
      )
      await new Promise<void>((resolve) => socket.once("message", () => resolve()))
      expect(broker.get("first", "project")?.inspecting).toBe(true)
      await broker.input("first", "project", { x: 0.5, y: 0.25, width: 400, height: 240 }, false)
      expect(moves).toEqual([{ type: "move", x: 200, y: 60 }])
      const selected = new Promise<{ method: string; params: { backendNodeId: number } }>((resolve) => {
        socket.once("message", (value) => resolve(JSON.parse(value.toString())))
      })
      await broker.input("first", "project", { x: 0.75, y: 0.5, width: 400, height: 240 }, true)
      expect(await selected).toEqual({ method: "Overlay.inspectNodeRequested", params: { backendNodeId: 42 } })
      expect(moves).toEqual([
        { type: "move", x: 200, y: 60 },
        { type: "move", x: 300, y: 120 },
        { type: "down" },
        { type: "up" },
      ])
      expect(broker.get("first", "project")?.inspecting).toBe(false)
      expect(broker.get("second", "project")?.inspecting).not.toBe(true)

      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
      await broker.close("first", "project")
      await closed
      expect((await fetch(first.url)).status).toBe(401)
      expect((await fetch(second.url)).status).toBe(200)
    } finally {
      await broker.disposeAsync()
      await new Promise<void>((resolve) => websocket.close(() => resolve()))
      await new Promise<void>((resolve) => remote.close(() => resolve()))
    }
  })

  test("rejects authenticated first-open requests for unknown sessions and directories", async () => {
    const broker = new BrowserBroker({ log: () => {} })
    brokers.push(broker)
    broker.bind((route) =>
      route.sessionId === "known" && route.directory === "/tmp/known" ? { ...route, projectId: "project" } : undefined,
    )
    const env = await broker.env()
    const headers = {
      authorization: `Bearer ${env.KILO_BROWSER_BROKER_TOKEN}`,
      "content-type": "application/json",
    }
    const url = `${env.KILO_BROWSER_BROKER_URL}/browser/open`
    for (const input of [
      { sessionID: "unknown", directory: "/tmp/known", url: "http://localhost:3000/" },
      { sessionID: "known", directory: "/tmp/other", url: "http://localhost:3000/" },
    ]) {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "Browser session does not belong to the requested project or directory",
      })
    }
    expect(broker.sessions()).toEqual([])
  })

  test("keeps browser contexts and HTTP rejection diagnostics isolated by session", async () => {
    const contexts: Array<{ close: () => Promise<void> }> = []
    const listeners = new Map<string, (value: unknown) => void>()
    let routeHandler:
      | ((
          route: { continue: () => Promise<void>; abort: () => Promise<void> },
          request: { url: () => string; isNavigationRequest?: () => boolean },
        ) => Promise<void>)
      | undefined
    let aborted = false
    const browser = {
      newContext: async () => {
        const page = {
          url: () => "http://localhost:3000",
          title: async () => "Local app",
          screenshot: async () => Buffer.from("jpeg"),
          on: (type: string, listener: (value: unknown) => void) => {
            listeners.set(type, listener)
          },
          mainFrame: () => undefined,
          goto: async () => undefined,
        }
        const context = {
          close: async () => undefined,
          route: async (_pattern: string, handler: typeof routeHandler) => {
            routeHandler = handler
          },
          routeWebSocket: async () => undefined,
          newPage: async () => page,
        }
        contexts.push(context)
        return context
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, launch: async () => browser })
    brokers.push(broker)
    await broker.open({ sessionId: "one", directory: "/tmp/project" }, "http://localhost:3000")
    await broker.open({ sessionId: "two", directory: "/tmp/project" }, "http://localhost:3000")
    expect(contexts).toHaveLength(2)
    expect(broker.get("one")?.browserId).not.toBe(broker.get("two")?.browserId)
    await routeHandler!(
      { continue: async () => undefined, abort: async () => void (aborted = true) },
      { url: () => "http://example.com" },
    )
    expect(aborted).toBe(true)
    const blocked = broker.get("two")
    expect(blocked).toMatchObject({
      errors: 1,
      logs: ["Blocked browser request: http://example.com"],
      error: undefined,
    })
    listeners.get("requestfailed")?.({ url: () => "http://example.com" })
    expect(broker.get("two")).toEqual(blocked)
    expect(broker.get("one")).toMatchObject({ errors: 0, logs: [], error: undefined })
    aborted = false
    await routeHandler!(
      { continue: async () => undefined, abort: async () => void (aborted = true) },
      { url: () => "data:text/html,<script>alert(1)</script>", isNavigationRequest: () => true },
    )
    expect(aborted).toBe(true)
    expect(broker.get("two")).toMatchObject({
      errors: 2,
      logs: ["Blocked browser request: http://example.com", "Blocked browser request: null"],
      error: undefined,
    })
    await broker.close("one")
    expect(broker.get("two")?.status).toBe("ready")
  })

  test("rejects disabled and untrusted browser sessions before launching Chrome", async () => {
    const route = { sessionId: "restricted", directory: "/tmp/project" }
    const disabled = new BrowserBroker({ log: () => {}, enabled: () => false })
    const untrusted = new BrowserBroker({ log: () => {}, trusted: () => false })
    await expect(disabled.open(route, "http://localhost:3000")).rejects.toThrow("Browser automation is disabled")
    await expect(untrusted.open(route, "http://localhost:3000")).rejects.toThrow("trusted workspace")
    expect(disabled.sessions()).toEqual([])
    expect(untrusted.sessions()).toEqual([])
  })

  test("explains how to recover when the selected browser runtime is missing", async () => {
    const broker = new BrowserBroker({
      log: () => {},
      useSystemChrome: () => false,
      launch: async () => {
        throw new Error("Browser executable does not exist")
      },
    })
    brokers.push(broker)
    await expect(
      broker.open({ sessionId: "missing-runtime", directory: "/tmp/project" }, "http://localhost:3000/"),
    ).rejects.toThrow("enable Use System Chrome")
    expect(broker.sessions()).toEqual([])
  })

  test("rejects unregistered browser sessions before launching Chrome", async () => {
    const broker = new BrowserBroker({ log: () => {} })
    broker.bind(() => undefined)
    await expect(
      broker.open({ projectId: "unknown", sessionId: "missing", directory: "/tmp/project" }, "http://localhost:3000/"),
    ).rejects.toThrow("Browser session does not belong to the requested project or directory")
    expect(broker.sessions()).toEqual([])
  })

  test("preserves project isolation, successful refresh, and captured HTTP errors", async () => {
    let status = 200
    let target = "about:blank"
    let navigations = 0
    let reloads = 0
    const page = {
      url: () => target,
      title: async () => (status === 404 ? "Missing page" : "Local app"),
      screenshot: async () => Buffer.from("jpeg"),
      on: (_type: string, _listener: (...args: never[]) => void) => undefined,
      mainFrame: () => undefined,
      goto: async (url: string) => {
        navigations++
        target = url
        return { status: () => status }
      },
      reload: async () => {
        reloads++
        return { status: () => status }
      },
    }
    const broker = fixture(page)
    broker.bind((route) => (route.sessionId === "session" && route.directory === "/tmp/project" ? route : undefined))
    const route = { projectId: "project-one", sessionId: "session", directory: "/tmp/project" }
    const opened = await broker.open(route, "http://localhost:3000/")
    expect(opened.status).toBe("ready")
    expect(opened.navigation).toBe(1)
    expect(opened.screenshot).toStartWith("data:image/jpeg;base64,")
    const reopened = await broker.open(route, "http://localhost:3000/")
    expect(navigations).toBe(1)
    expect(reloads).toBe(1)
    expect(reopened.navigation).toBe(2)
    const other = await broker.open({ ...route, projectId: "project-two" }, "http://localhost:3000/")
    expect(other.browserId).not.toBe(opened.browserId)
    expect(broker.get(route.sessionId)).toBeUndefined()
    expect(broker.get(route.sessionId, "project-two")?.browserId).toBe(other.browserId)
    const refreshed = await broker.refresh(route.sessionId, route.projectId)
    expect(refreshed.status).toBe("ready")
    expect(refreshed.navigation).toBe(3)
    expect(reloads).toBe(2)
    status = 404
    await expect(broker.refresh(route.sessionId, route.projectId)).rejects.toThrow(
      "Local application returned HTTP 404",
    )
    expect(broker.get(route.sessionId, route.projectId)).toMatchObject({
      projectId: "project-one",
      status: "error",
      title: "Missing page",
      url: "http://localhost:3000/",
      error: "Local application returned HTTP 404",
    })
    expect(broker.get(route.sessionId, route.projectId)?.screenshot).toStartWith("data:image/jpeg;base64,")
    status = 200
    const recovered = await broker.open(route, "http://localhost:3000/recovered")
    expect(recovered).toMatchObject({ status: "ready", errors: 0, url: "http://localhost:3000/recovered" })
    expect(recovered.error).toBeUndefined()
  })

  test("reports response headers that prevent embedding the real application document", async () => {
    let headers: Record<string, string> = {}
    let target = "about:blank"
    const page = {
      url: () => target,
      title: async () => "Local app",
      screenshot: async () => Buffer.from("jpeg"),
      on: (_type: string, _listener: (...args: never[]) => void) => undefined,
      mainFrame: () => undefined,
      goto: async (url: string) => {
        target = url
        return { status: () => 200, headers: () => headers }
      },
    }
    const broker = fixture(page)
    const route = { sessionId: "framed", directory: "/tmp/project" }
    expect((await broker.open(route, "http://localhost:3000/open")).frameError).toBeUndefined()
    headers = { "x-frame-options": "DENY" }
    expect((await broker.open(route, "http://localhost:3000/deny")).frameError).toContain("X-Frame-Options: DENY")
    headers = { "x-frame-options": "SAMEORIGIN" }
    expect((await broker.open(route, "http://localhost:3000/same-origin")).frameError).toContain("SAMEORIGIN")
    headers = { "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }
    expect((await broker.open(route, "http://localhost:3000/csp")).frameError).toContain("frame-ancestors 'none'")
    headers = {}
    expect((await broker.open(route, "http://localhost:3000/recovered")).frameError).toBeUndefined()
  })

  test("serializes concurrent navigation and close without reviving a stale session", async () => {
    let contexts = 0
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const navigating = new Promise<void>((resolve) => {
      started = resolve
    })
    let target = "about:blank"
    const page = {
      url: () => target,
      title: async () => "Local app",
      screenshot: async () => Buffer.from("jpeg"),
      on: (_type: string, _listener: (...args: never[]) => void) => undefined,
      mainFrame: () => undefined,
      goto: async (url: string) => {
        target = url
        started?.()
        await waiting
      },
    }
    const browser = {
      newContext: async () => {
        contexts++
        return {
          close: async () => undefined,
          route: async () => undefined,
          routeWebSocket: async () => undefined,
          newPage: async () => page,
        }
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, launch: async () => browser })
    brokers.push(broker)
    const states: string[] = []
    broker.subscribe((state) => states.push(state.status))
    const route = { sessionId: "concurrent", directory: "/tmp/project" }
    const first = broker.open(route, "http://localhost:3000/one")
    await navigating
    const second = broker.open(route, "http://localhost:3000/two")
    const closed = broker.close(route.sessionId)
    release?.()
    await Promise.all([first, second, closed])
    expect(contexts).toBe(1)
    expect(broker.get(route.sessionId)).toBeUndefined()
    expect(states.at(-1)).toBe("closed")
  })

  test("does not create a context after disposal interrupts browser launch", async () => {
    let resume: (() => void) | undefined
    let launched: (() => void) | undefined
    let contexts = 0
    const waiting = new Promise<void>((resolve) => {
      resume = resolve
    })
    const starting = new Promise<void>((resolve) => {
      launched = resolve
    })
    const browser = {
      newContext: async () => {
        contexts++
        throw new Error("unexpected context")
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({
      log: () => {},
      launch: async () => {
        launched?.()
        await waiting
        return browser
      },
    })
    const opened = broker.open({ sessionId: "disposed", directory: "/tmp/project" }, "http://localhost:3000/")
    await starting
    const disposed = broker.disposeAsync()
    resume?.()
    await expect(opened).rejects.toThrow("Browser broker is closed")
    await disposed
    expect(contexts).toBe(0)
    expect(broker.sessions()).toEqual([])
  })

  test("records bounded console diagnostics and inspects selected page elements", async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    let viewport: { width: number; height: number } | undefined
    let resizes = 0
    const page = {
      url: () => "http://localhost:3000/",
      title: async () => "Feedback demo",
      screenshot: async () => Buffer.from("jpeg"),
      on: (type: string, listener: (value: unknown) => void) => {
        listeners.set(type, listener)
      },
      mainFrame: () => undefined,
      goto: async () => undefined,
      reload: async () => {
        listeners.get("console")?.({ type: () => "log", text: () => "DEMO_RELOAD_LOG: refreshed application" })
      },
      viewportSize: () => viewport,
      setViewportSize: async (size: { width: number; height: number }) => {
        viewport = size
        resizes++
      },
      evaluate: async () => ({
        tag: "section",
        id: "feature-card",
        text: "Blue feedback card",
        selector: "#feature-card",
      }),
    }
    const broker = fixture(page)
    await broker.open(
      { projectId: "project", sessionId: "feedback", directory: "/tmp/project" },
      "http://localhost:3000/",
    )
    listeners.get("console")?.({ type: () => "log", text: () => "DEMO_STARTUP_LOG: page loaded" })
    listeners.get("console")?.({ type: () => "info", text: () => "DEMO_STARTUP_INFO: ready" })
    listeners.get("console")?.({ type: () => "warning", text: () => "DEMO_STARTUP_WARNING: check layout" })
    listeners.get("console")?.({ type: () => "error", text: () => "DEMO_STARTUP_ERROR: script initialized" })
    listeners.get("pageerror")?.(new Error("DEMO_PAGE_ERROR: broken element"))
    const inspected = await broker.inspect("feedback", "project", { x: 0.4, y: 0.3, width: 760, height: 580 })
    expect(viewport).toEqual({ width: 760, height: 580 })
    expect(inspected.element).toMatchObject({
      tag: "section",
      id: "feature-card",
      text: "Blue feedback card",
      selector: "#feature-card",
    })
    expect(inspected.logs).toEqual([
      "[log] DEMO_STARTUP_LOG: page loaded",
      "[info] DEMO_STARTUP_INFO: ready",
      "[warning] DEMO_STARTUP_WARNING: check layout",
      "[error] DEMO_STARTUP_ERROR: script initialized",
      "DEMO_PAGE_ERROR: broken element",
    ])
    expect(broker.get("feedback", "project")?.errors).toBe(2)
    expect(broker.get("feedback", "project")?.logs).toEqual(inspected.logs)
    await broker.inspect("feedback", "project", { x: 0.2, y: 0.4, width: 760, height: 580 })
    expect(resizes).toBe(1)
    const reloaded = await broker.open(
      { projectId: "project", sessionId: "feedback", directory: "/tmp/project" },
      "http://localhost:3000/",
    )
    expect(reloaded.navigation).toBe(2)
    expect(reloaded.errors).toBe(0)
    expect(reloaded.logs).toEqual(["[log] DEMO_RELOAD_LOG: refreshed application"])
    await expect(broker.inspect("feedback", "project", { x: 1.2, y: 0.3, width: 760, height: 580 })).rejects.toThrow(
      "Browser element coordinates are invalid",
    )
    for (let index = 0; index < 25; index++) {
      listeners.get("console")?.({ type: () => "error", text: () => `error-${index}` })
    }
    expect(broker.get("feedback", "project")?.logs).toHaveLength(20)
  })

  test("blocks browser popups without replacing navigation failures", async () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    const page = {
      url: () => "http://localhost:3000/",
      title: async () => "Local app",
      screenshot: async () => Buffer.from("jpeg"),
      on: (type: string, listener: (...args: never[]) => void) => {
        listeners.set(type, listener)
      },
      mainFrame: () => undefined,
      goto: async () => undefined,
      reload: async () => {
        throw new Error("Navigation failed")
      },
    }
    const broker = fixture(page)
    await broker.open({ sessionId: "popup", directory: "/tmp/project" }, "http://localhost:3000/")
    let closed = false
    listeners.get("popup")!({ close: async () => void (closed = true) } as never)
    expect(closed).toBe(true)
    expect(broker.get("popup")).toMatchObject({ errors: 1, logs: ["Blocked browser popup"], error: undefined })
    await expect(broker.refresh("popup")).rejects.toThrow("Navigation failed")
    closed = false
    listeners.get("popup")!({ close: async () => void (closed = true) } as never)
    expect(closed).toBe(true)
    expect(broker.get("popup")).toMatchObject({
      status: "error",
      errors: 1,
      logs: ["Blocked browser popup"],
      error: "Navigation failed",
    })
  })

  test("allows only same-origin WebSockets", async () => {
    let handler:
      | ((socket: { url: () => string; connectToServer: () => void; close: () => Promise<void> }) => Promise<void>)
      | undefined
    const page = {
      url: () => "http://localhost:3000/",
      title: async () => "Local app",
      screenshot: async () => Buffer.from("jpeg"),
      on: (_type: string, _listener: (...args: never[]) => void) => undefined,
      mainFrame: () => undefined,
      goto: async () => undefined,
    }
    const browser = {
      newContext: async () => ({
        close: async () => undefined,
        route: async () => undefined,
        routeWebSocket: async (_pattern: string, next: typeof handler) => {
          handler = next
        },
        newPage: async () => page,
      }),
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, launch: async () => browser })
    brokers.push(broker)
    await broker.open({ sessionId: "socket", directory: "/tmp/project" }, "http://localhost:3000/")
    let connected = false
    let closed = false
    await handler!({
      url: () => "ws://localhost:3000/hmr",
      connectToServer: () => void (connected = true),
      close: async () => void (closed = true),
    })
    expect(connected).toBe(true)
    expect(closed).toBe(false)
    expect(broker.get("socket")).toMatchObject({ errors: 0, logs: [], error: undefined })
    connected = false
    await handler!({
      url: () => "ws://localhost:4000/private",
      connectToServer: () => void (connected = true),
      close: async () => void (closed = true),
    })
    expect(connected).toBe(false)
    expect(closed).toBe(true)
    expect(broker.get("socket")).toMatchObject({
      errors: 1,
      logs: ["Blocked browser request: ws://localhost:4000"],
      error: undefined,
    })
  })
})
