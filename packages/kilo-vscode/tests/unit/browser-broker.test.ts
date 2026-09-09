import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createServer, request, type IncomingMessage } from "node:http"
import { connect } from "node:net"
import { PassThrough } from "node:stream"
import { runInNewContext } from "node:vm"
import WebSocket, { WebSocketServer } from "ws"
import {
  BrowserBroker,
  BrowserLaunchError,
  diagnostic,
  type BrowserBrokerOptions,
} from "../../src/services/browser-automation/browser-broker"
import { BrowserDevtools } from "../../src/services/browser-automation/browser-devtools"
import type { BrowserFrame } from "../../src/shared/browser-stream"

const brokers: BrowserBroker[] = []
type Network = NonNullable<BrowserBrokerOptions["network"]>
const network: Network = async () => ({
  active: true,
  authorize: () => undefined,
  close: async () => undefined,
})

function fixture<T>(page: T, attach: Network = network) {
  const broker = new BrowserBroker({
    log: () => {},
    network: attach,
    launch: async () => ({
      newContext: async () => ({
        close: async () => undefined,
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
  test("accepts HTTP loopback and public HTTPS URLs", () => {
    const broker = new BrowserBroker({ log: () => {} })
    expect(broker.validate("http://localhost:3000/path").origin).toBe("http://localhost:3000")
    expect(broker.validate("https://www.google.com/search?q=typescript").href).toBe(
      "https://www.google.com/search?q=typescript",
    )
    expect(() => broker.validate("https://localhost:3000")).toThrow()
    expect(() => broker.validate("http://127.0.0.1:3000")).not.toThrow()
    expect(() => broker.validate("http://[::1]:3000")).toThrow()
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
    expect(diagnostic(new Error("page.goto: Timeout 15000ms exceeded"), "https://google.com/")).toBe(
      "The website did not respond in time. Check the URL and network connection, then try again.",
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

  test.each(["pending", "approved"])("distinguishes %s human approval from a network timeout", async (mode) => {
    const decision = Promise.withResolvers<boolean>()
    const callbacks: Array<Parameters<Network>[1]["approve"]> = []
    const approvals: Array<Promise<boolean>> = []
    const control = {
      active: true,
      authorize: () => undefined,
      async close() {
        this.active = false
      },
    }
    const broker = fixture(
      {
        url: () => "about:blank",
        title: async () => "",
        screenshot: async () => Buffer.from("jpeg"),
        on: () => undefined,
        mainFrame: () => undefined,
        goto: async () => {
          const approval = callbacks.at(0)!(new URL("https://www.google.com/"))
          approvals.push(approval)
          if (mode === "approved") {
            decision.resolve(true)
            await approval
          }
          throw new Error("page.goto: Timeout 15000ms exceeded\nCall log:\n- navigating")
        },
      },
      async (_page, opts) => {
        callbacks.push(opts.approve)
        return control
      },
    )
    broker.bind(
      (route) => route,
      () => decision.promise,
    )
    const env = await broker.env()
    const response = await fetch(`${env.KILO_BROWSER_BROKER_URL}/browser/open`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.KILO_BROWSER_BROKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionID: "approval", directory: "/tmp/project", url: "https://google.com/" }),
    })
    const message =
      mode === "pending"
        ? "Browser navigation stopped while waiting for approval in VS Code. Dismiss the approval prompt and retry."
        : "The website did not respond in time. Check the URL and network connection, then try again."
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(broker.get("approval")).toMatchObject({ status: "error", error: message })
    expect(control.active).toBe(mode === "approved")
    decision.resolve(true)
    expect(await approvals.at(0)).toBe(mode === "approved")
  })

  test("skips snapshots for streamed UI navigation but retains fresh agent screenshots", async () => {
    let url = "about:blank"
    let shots = 0
    const page = {
      url: () => url,
      title: async () => "Local fixture",
      screenshot: async () => Buffer.from(`shot-${++shots}`),
      on: () => undefined,
      mainFrame: () => undefined,
      goto: async (value: string) => {
        url = value
      },
      reload: async () => undefined,
    }
    const broker = fixture(page)
    const route = { sessionId: "streamed", projectId: "project", directory: "/tmp/project" }
    const target = "http://localhost:3000/"
    expect(await broker.open(route, target, false)).toMatchObject({ status: "ready", screenshot: undefined })
    expect(await broker.refresh(route.sessionId, route.projectId, false)).toMatchObject({
      status: "ready",
      screenshot: undefined,
    })
    expect(shots).toBe(0)
    expect((await broker.open(route, target)).screenshot).toBe(
      `data:image/jpeg;base64,${Buffer.from("shot-1").toString("base64")}`,
    )
    expect(shots).toBe(1)
    expect((await broker.open(route, `${target}next`, false)).screenshot).toBeUndefined()
    expect(shots).toBe(1)
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
          newPage: async () => page,
          newCDPSession: async () => ({
            send: async () => ({ targetInfo: { targetId: id } }),
            detach: async () => undefined,
          }),
        }
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, network, launch: async () => browser })
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

  test("keeps injected network diagnostics and context cleanup isolated by session", async () => {
    const contexts: Array<{ close: () => Promise<void> }> = []
    const callbacks: Array<Parameters<Network>[1]["blocked"]> = []
    const closed: number[] = []
    const retired: number[] = []
    const browser = {
      newContext: async () => {
        const id = contexts.length
        const page = {
          url: () => "http://localhost:3000/",
          title: async () => "Local app",
          screenshot: async () => Buffer.from("jpeg"),
          on: () => undefined,
          mainFrame: () => undefined,
          goto: async () => undefined,
        }
        const context = {
          close: async () => void closed.push(id),
          newPage: async () => page,
        }
        contexts.push(context)
        return context
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({
      log: () => {},
      launch: async () => browser,
      network: async (_page, opts) => {
        const id = callbacks.length
        callbacks.push(opts.blocked)
        return { active: true, authorize: () => undefined, close: async () => void retired.push(id) }
      },
    })
    brokers.push(broker)
    await broker.open({ sessionId: "one", directory: "/tmp/project" }, "http://localhost:3000/")
    await broker.open({ sessionId: "two", directory: "/tmp/project" }, "http://localhost:3000/")
    expect(contexts).toHaveLength(2)
    expect(callbacks).toHaveLength(2)
    expect(broker.get("one")?.browserId).not.toBe(broker.get("two")?.browserId)
    callbacks.at(1)!("Browser navigation was not approved")
    expect(broker.get("two")).toMatchObject({
      status: "ready",
      errors: 0,
      logs: [],
      error: "Browser navigation was not approved",
    })
    expect(broker.get("one")).toMatchObject({ errors: 0, logs: [], error: undefined })
    await broker.close("one")
    expect(closed).toEqual([0])
    expect(retired).toEqual([0])
    expect(broker.get("one")).toBeUndefined()
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

  test.each([
    ["macOS", true, "Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app", "chrome"],
    [
      "Windows",
      true,
      "Chromium distribution 'chrome' is not found at C:\\Program Files\\Google\\Chrome\\chrome.exe",
      "chrome",
    ],
    ["Linux", true, "Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome", "chrome"],
    ["Playwright", false, "Executable doesn't exist at /cache/chromium_headless_shell/chrome", "chromium"],
  ] as const)("identifies a missing browser on %s and allows retries", async (_platform, system, message, missing) => {
    const cause = new Error(`browserType.launch: ${message}`)
    let attempts = 0
    const broker = new BrowserBroker({
      log: () => {},
      useSystemChrome: () => system,
      launch: async () => {
        attempts++
        throw cause
      },
    })
    brokers.push(broker)
    const open = () =>
      broker.open({ sessionId: "missing-runtime", directory: "/tmp/project" }, "http://localhost:3000/")
    await expect(open()).rejects.toMatchObject({ name: "BrowserLaunchError", missing, cause })
    await expect(open()).rejects.toThrow(system ? "Install Chrome" : "enable Use System Chrome")
    expect(attempts).toBe(2)
    expect(broker.sessions()).toEqual([])
  })

  test.each([
    "No usable sandbox!",
    "error while loading shared libraries: libnss3.so: cannot open shared object file",
    "Timeout 30000ms exceeded",
    "Target page, context or browser has been closed",
  ])("does not misreport a browser startup failure as a missing installation: %s", async (message) => {
    const broker = new BrowserBroker({
      log: () => {},
      launch: async () => {
        throw new Error(message)
      },
    })
    brokers.push(broker)
    const error = await broker
      .open({ sessionId: "startup", directory: "/tmp/project" }, "http://localhost:3000/")
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(BrowserLaunchError)
    expect(error).toMatchObject({ missing: undefined })
    expect(diagnostic(error, "http://localhost:3000/")).toBe(`The browser could not start. ${message}`)
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

  test("does not report iframe restrictions as errors for streamed pages", async () => {
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
    expect((await broker.open(route, "http://localhost:3000/deny")).frameError).toBeUndefined()
    headers = { "x-frame-options": "SAMEORIGIN" }
    expect((await broker.open(route, "http://localhost:3000/same-origin")).frameError).toBeUndefined()
    headers = { "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }
    expect((await broker.open(route, "http://localhost:3000/csp")).frameError).toBeUndefined()
    expect(broker.get(route.sessionId)).toMatchObject({ status: "ready", error: undefined })
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
          newPage: async () => page,
        }
      },
      close: async () => undefined,
    }
    const broker = new BrowserBroker({ log: () => {}, network, launch: async () => browser })
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

  test.each(["creation", "replacement", "queued replacement", "disposal"])(
    "closes the current entry during %s",
    async (phase) => {
      const entered = Promise.withResolvers<void>()
      const deferred = Promise.withResolvers<void>()
      const contexts: Array<{ proxy: string; closed: number }> = []
      const states: string[] = []
      const stopped: number[] = []
      const replace = phase.includes("replacement")
      const broker = new BrowserBroker({
        log: () => undefined,
        network,
        launch: async () => ({
          newContext: async (opts) => {
            const id = contexts.length
            const context = { proxy: opts.proxy!.server, closed: 0 }
            contexts.push(context)
            if (id === (replace ? 1 : 0)) {
              entered.resolve()
              await deferred.promise
            }
            let target = "about:blank"
            return {
              close: async () => void context.closed++,
              newPage: async () => ({
                url: () => target,
                title: async () => "Application",
                screenshot: async () => Buffer.from("jpeg"),
                on: () => undefined,
                mainFrame: () => undefined,
                goto: async (url: string) => void (target = url),
              }),
            }
          },
          close: async () => void stopped.push(...contexts.map((context) => context.closed)),
        }),
      })
      brokers.push(broker)
      broker.subscribe((state) => states.push(state.status))
      const route = { projectId: "project", sessionId: "pending", directory: "/tmp/project" }
      if (replace) await broker.open(route, "http://localhost:3000/")
      const opened = broker.open(route, "https://example.com/")
      if (phase !== "queued replacement") await entered.promise
      const sessions = broker.sessions()
      const closed =
        phase === "disposal"
          ? broker.disposeAsync()
          : Promise.all(sessions.map((session) => broker.close(session, route.projectId)))
      await entered.promise
      const offline =
        phase === "disposal"
          ? await fetch(contexts.at(0)!.proxy).then(
              () => false,
              () => true,
            )
          : undefined
      deferred.resolve()
      await Promise.all([
        phase === "disposal" ? expect(opened).rejects.toThrow("Browser broker is closed") : opened,
        closed,
      ])
      expect(sessions).toEqual([route.sessionId])
      expect(contexts).toHaveLength(replace ? 2 : 1)
      expect(contexts.map((context) => context.closed)).toEqual(contexts.map(() => 1))
      expect(broker.get(route.sessionId, route.projectId)).toBeUndefined()
      expect(states.at(-1)).toBe("closed")
      if (phase === "disposal") {
        expect(offline).toBe(true)
        expect(stopped).toEqual([1])
      }
      for (const context of contexts) await expect(fetch(context.proxy)).rejects.toThrow()
    },
  )

  test.each(["project", "workspace"])("closes enumerated pending creations during %s shutdown", async (mode) => {
    const scoped = mode === "project"
    const entered = Promise.withResolvers<void>()
    const deferred = Promise.withResolvers<void>()
    let contexts = 0
    const broker = new BrowserBroker({
      log: () => undefined,
      network,
      launch: async () => ({
        newContext: async () => {
          const id = ++contexts
          if (id === 3) entered.resolve()
          if (id > 1) await deferred.promise
          let target = "about:blank"
          return {
            close: async () => undefined,
            newPage: async () => ({
              url: () => target,
              title: async () => "Application",
              screenshot: async () => Buffer.from("jpeg"),
              on: () => undefined,
              mainFrame: () => undefined,
              goto: async (url: string) => void (target = url),
            }),
          }
        },
        close: async () => undefined,
      }),
    })
    brokers.push(broker)
    const route = { projectId: "one", sessionId: "pending", directory: "/tmp/project" }
    await broker.open({ ...route, projectId: "two", sessionId: "other" }, "http://localhost:3000/")
    const first = broker.open(route, "http://localhost:3000/")
    const second = broker.open({ ...route, projectId: "two" }, "http://localhost:3000/")
    await entered.promise
    const sessions = broker.sessions().sort()
    const closed = Promise.all(sessions.map((session) => broker.close(session, scoped ? route.projectId : undefined)))
    deferred.resolve()
    await Promise.all([first, second, closed])
    expect(sessions).toEqual(["other", "pending"])
    expect(broker.get(route.sessionId, "one")).toBeUndefined()
    expect(broker.get(route.sessionId, "two")?.status).toBe(scoped ? "ready" : undefined)
    expect(broker.get("other", "two")?.status).toBe(scoped ? "ready" : undefined)
    expect(broker.sessions().sort()).toEqual(scoped ? ["other", "pending"] : [])
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

  test("rejects stale browser, navigation, and revision identities for streams", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
    const frames: BrowserFrame[] = []
    const protocol = Object.assign(new EventEmitter(), {
      send: async (method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params })
        return {}
      },
      detach: async () => void calls.push({ method: "detach" }),
    })
    const page = Object.assign(new EventEmitter(), {
      url: () => "http://localhost:3000/",
      title: async () => "Application",
      screenshot: async () => Buffer.from("jpeg"),
      context: () => ({ newCDPSession: async () => protocol }),
      mainFrame: () => page,
      goto: async () => undefined,
      reload: async () => undefined,
      setViewportSize: async (size: { width: number; height: number }) => {
        calls.push({ method: "resize", params: size })
      },
    })
    const broker = fixture(page)
    const route = { projectId: "project", sessionId: "session", directory: "/tmp/project" }
    const opened = await broker.open(route, "http://localhost:3000/")
    const viewport = { width: 640, height: 480, revision: 2, active: true }
    const identity = { browserId: opened.browserId, navigation: opened.navigation, revision: viewport.revision }
    const off = broker.frames((frame) => frames.push(frame))
    await broker.viewport(route.sessionId, route.projectId, "retired", identity.navigation, viewport)
    await broker.viewport(route.sessionId, route.projectId, identity.browserId, identity.navigation - 1, viewport)
    expect(calls).toEqual([])
    await broker.viewport(route.sessionId, route.projectId, identity.browserId, identity.navigation, viewport)
    const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217])
    jpeg.writeUInt16BE(viewport.height, 7)
    jpeg.writeUInt16BE(viewport.width, 9)
    const frame = (id: number) =>
      protocol.emit("Page.screencastFrame", {
        sessionId: id,
        data: jpeg.toString("base64"),
        metadata: { deviceWidth: viewport.width, deviceHeight: viewport.height },
      })
    frame(1)
    frame(2)
    expect(frames).toHaveLength(1)
    expect(frames.at(0)).toMatchObject({ ...identity, sessionId: route.sessionId, projectId: route.projectId })
    const count = calls.length
    for (const stale of [
      { ...identity, browserId: "retired" },
      { ...identity, navigation: identity.navigation - 1 },
      { ...identity, revision: identity.revision - 1 },
    ]) {
      await broker.viewport(route.sessionId, route.projectId, stale.browserId, stale.navigation, {
        ...viewport,
        revision: stale.revision,
      })
      expect(broker.accepts(route.sessionId, route.projectId, stale)).toBe(false)
      await broker.interact(route.sessionId, route.projectId, stale, { kind: "text", text: "stale" })
      broker.acknowledge(route.sessionId, route.projectId, stale, frames.at(0)!.sequence)
    }
    expect(calls).toHaveLength(count)
    expect(frames).toHaveLength(1)
    expect(broker.accepts(route.sessionId, route.projectId, identity)).toBe(true)
    broker.acknowledge(route.sessionId, route.projectId, identity, frames.at(0)!.sequence)
    expect(frames).toHaveLength(2)
    await broker.interact(route.sessionId, route.projectId, identity, { kind: "text", text: "current" })
    const refreshed = await broker.refresh(route.sessionId, route.projectId)
    expect(broker.accepts(route.sessionId, route.projectId, identity)).toBe(false)
    await broker.interact(route.sessionId, route.projectId, identity, { kind: "text", text: "stale" })
    expect(calls.filter((call) => call.method === "Input.insertText")).toEqual([
      { method: "Input.insertText", params: { text: "current" } },
    ])
    frame(3)
    expect(frames.at(-1)).toMatchObject({ navigation: refreshed.navigation, revision: viewport.revision })
    const current = { ...identity, navigation: refreshed.navigation, revision: 3 }
    await broker.viewport(route.sessionId, route.projectId, current.browserId, current.navigation, {
      ...viewport,
      revision: current.revision,
    })
    expect(broker.accepts(route.sessionId, route.projectId, { ...current, revision: 2 })).toBe(false)
    expect(broker.accepts(route.sessionId, route.projectId, current)).toBe(true)
    frame(4)
    expect(frames.at(-1)).toMatchObject(current)
    await broker.close(route.sessionId, route.projectId)
    frame(5)
    expect(frames).toHaveLength(4)
    expect(broker.accepts(route.sessionId, route.projectId, current)).toBe(false)
    expect(protocol.listenerCount("Page.screencastFrame")).toBe(0)
    off()
  })

  test("closes a context before waiting on a blocked renderer and permits reopening", async () => {
    const entered = Promise.withResolvers<void>()
    const selected = Promise.withResolvers<{ focused: boolean; text: string }>()
    const released = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    let contexts = 0
    const protocol = Object.assign(new EventEmitter(), {
      send: async () => ({}),
      detach: async () => undefined,
    })
    const page = Object.assign(new EventEmitter(), {
      url: () => "http://localhost:3000/",
      title: async () => "Application",
      screenshot: async () => Buffer.from("jpeg"),
      context: () => ({ newCDPSession: async () => protocol }),
      mainFrame: () => page,
      goto: async () => undefined,
      setViewportSize: async () => undefined,
      evaluate: async () => {
        entered.resolve()
        return selected.promise
      },
    })
    const broker = new BrowserBroker({
      log: () => {},
      network: async () => ({ active: true, authorize: () => undefined, close: () => released.promise }),
      launch: async () => ({
        newContext: async () => {
          contexts++
          return {
            newPage: async () => page,
            close: async () => {
              selected.reject(new Error("Context closed"))
              released.resolve()
              closed.resolve()
            },
          }
        },
        close: async () => undefined,
      }),
    })
    brokers.push(broker)
    const route = { projectId: "project", sessionId: "session", directory: "/tmp/project" }
    const state = await broker.open(route, "http://localhost:3000/", false)
    const identity = { browserId: state.browserId, navigation: state.navigation, revision: 1 }
    await broker.viewport(route.sessionId, route.projectId, state.browserId, state.navigation, {
      width: 320,
      height: 200,
      active: true,
      revision: 1,
    })
    const copying = broker.interact(route.sessionId, route.projectId, identity, { kind: "clipboard", action: "copy" })
    await entered.promise
    const closing = broker.close(route.sessionId, route.projectId)
    try {
      await Promise.race([
        closed.promise,
        Bun.sleep(1000).then(() => {
          throw new Error("Context closure is blocked by renderer work")
        }),
      ])
      await closing
      expect(await copying).toBeUndefined()
      expect(broker.get(route.sessionId, route.projectId)).toBeUndefined()
      expect(protocol.listenerCount("Page.screencastFrame")).toBe(0)
      const reopened = await broker.open(route, "http://localhost:3000/", false)
      expect(contexts).toBe(2)
      expect(reopened.status).toBe("ready")
      expect(reopened.browserId).not.toBe(state.browserId)
    } finally {
      selected.resolve({ focused: true, text: "stale" })
      released.resolve()
      await Promise.allSettled([copying, closing])
    }
  })

  test.each([
    ["http://localhost:3000/", "https://www.google.com/"],
    ["https://www.google.com/", "http://localhost:3000/"],
    ["http://localhost:3000/", "http://localhost:4000/"],
  ])("replaces the browser context from %s to %s", async (first, second) => {
    const closed: string[] = []
    const attached: string[] = []
    let contexts = 0
    const broker = new BrowserBroker({
      log: () => {},
      network: async (_page, opts) => {
        const id = attached.push(opts.url.href)
        return { active: true, authorize: () => undefined, close: async () => void closed.push(`network:${id}`) }
      },
      launch: async () => ({
        newContext: async () => {
          const id = ++contexts
          let target = "about:blank"
          return {
            close: async () => void closed.push(`context:${id}`),
            newPage: async () => ({
              url: () => target,
              title: async () => "Application",
              screenshot: async () => Buffer.from("jpeg"),
              on: () => undefined,
              mainFrame: () => undefined,
              goto: async (url: string) => void (target = url),
            }),
          }
        },
        close: async () => undefined,
      }),
    })
    brokers.push(broker)
    const route = { projectId: "project", sessionId: "session", directory: "/tmp/project" }
    const before = await broker.open(route, first)
    const after = await broker.open(route, second)
    expect(contexts).toBe(2)
    expect(attached).toEqual([first, second])
    expect(closed).toEqual(["network:1", "context:1"])
    expect(after.browserId).not.toBe(before.browserId)
    expect(broker.get(route.sessionId, route.projectId)).toMatchObject({
      browserId: after.browserId,
      status: "ready",
      navigation: 1,
      url: second,
    })
    await broker.close(route.sessionId, route.projectId)
    expect(closed).toEqual(["network:1", "context:1", "network:2", "context:2"])
  })

  test("refreshes without granting navigation and reuses public contexts for explicit opens", async () => {
    const grants: string[] = []
    let target = "about:blank"
    let reloads = 0
    const page = {
      url: () => target,
      title: async () => "Application",
      screenshot: async () => Buffer.from("jpeg"),
      on: () => undefined,
      mainFrame: () => undefined,
      goto: async (url: string) => void (target = url),
      reload: async () => void reloads++,
    }
    const broker = fixture(page, async () => ({
      active: true,
      authorize: (url) => void grants.push(url.href),
      close: async () => undefined,
    }))
    const route = { projectId: "project", sessionId: "session", directory: "/tmp/project" }
    const first = await broker.open(route, "https://www.google.com/")
    await broker.refresh(route.sessionId, route.projectId)
    expect(grants).toEqual([])
    const second = await broker.open(route, "https://example.com/")
    expect(second.browserId).toBe(first.browserId)
    expect(grants).toEqual(["https://example.com/"])
    await broker.refresh(route.sessionId, route.projectId)
    expect(grants).toEqual(["https://example.com/"])
    expect(reloads).toBe(2)
  })
})
