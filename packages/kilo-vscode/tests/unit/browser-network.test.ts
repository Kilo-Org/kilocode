import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createHash, X509Certificate } from "node:crypto"
import { createSocket } from "node:dgram"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createServer as https } from "node:https"
import { connect, createServer as tcp, type Server, type Socket } from "node:net"
import { chromium, type Browser, type BrowserContext, type Request } from "playwright-core"
import { WebSocketServer } from "ws"
import { BrowserBroker } from "../../src/services/browser-automation/browser-broker"
import { BrowserNetwork } from "../../src/services/browser-automation/browser-network"
import { BrowserProxy } from "../../src/services/browser-automation/browser-proxy"
import { options } from "../../src/services/browser-automation/browser-runtime"
import { cert, key } from "../fixtures/browser-network-tls"

const executable = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  chromium.executablePath(),
].find((path) => path && existsSync(path))
const proxies: BrowserProxy[] = []
const networks: BrowserNetwork[] = []
const contexts: BrowserContext[] = []
const cleanup: Array<() => void | Promise<unknown>> = []

async function listen(server: Server) {
  const sockets = new Set<Socket>()
  let contacts = 0
  server.on("connection", (socket) => {
    contacts++
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
  })
  const ready = once(server, "listening")
  server.listen(0, "127.0.0.1")
  await ready
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture port")
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return { port: address.port, contacts: () => contacts }
}

function websocket(server: ReturnType<typeof createServer>) {
  const sockets = new WebSocketServer({ server })
  const requests: IncomingMessage[] = []
  sockets.on("connection", (socket, request) => {
    requests.push(request)
    socket.on("message", (data) => socket.send(data.toString()))
    socket.on("error", () => socket.terminate())
  })
  cleanup.push(() => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
  })
  return requests
}

async function secure(name: string, handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: IncomingMessage[] = []
  const server = https({ cert, key }, (request, response) => {
    requests.push(request)
    handle(request, response)
  })
  const target = await listen(server)
  return { ...target, server, requests, url: new URL(`https://${name}.browser.test:${target.port}/`) }
}

async function transport(ports: number[], policy: "public" | URL = "public") {
  return BrowserProxy.start(policy, {
    lookup: async (host) => {
      if (host === "localhost" || host === "loop.browser.test") return [{ address: "127.0.0.1", family: 4 }]
      if (!host.endsWith(".browser.test")) throw new Error("Unexpected fixture hostname")
      return [{ address: "8.8.8.8", family: 4 }]
    },
    connect: (options) => {
      if (options.host !== "8.8.8.8") return connect(options)
      if (options.family !== 4 || !ports.includes(options.port)) throw new Error("Unmapped fixture address")
      return connect({ ...options, host: "127.0.0.1" })
    },
  })
}

describe.skipIf(!executable)("BrowserNetwork Chromium", () => {
  let browser: Browser
  let gateway: BrowserProxy

  async function launch(pinned = true, flags: string[] = []) {
    const base = options(false)
    const pin = createHash("sha256")
      .update(new X509Certificate(cert).publicKey.export({ format: "der", type: "spki" }))
      .digest("base64")
    return chromium.launch({
      ...base,
      executablePath: executable,
      proxy: gateway.proxy,
      ignoreDefaultArgs: ["--disable-popup-blocking"],
      args: [
        ...(base.args ?? []).filter((arg) => arg !== "--no-proxy-server"),
        ...flags,
        "--disable-quic",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ...(pinned ? [`--ignore-certificate-errors-spki-list=${pin}`] : []),
      ],
    })
  }

  beforeAll(async () => {
    gateway = await BrowserProxy.start("deny")
    browser = await launch()
  }, 20000)

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
    await Promise.all(networks.splice(0).map((network) => network.close()))
    await Promise.all(contexts.splice(0).map((context) => context.close()))
    for (const close of cleanup.splice(0).reverse()) await close()
  })

  afterAll(async () => {
    await browser?.close()
    await gateway?.close()
  })

  async function session(
    url: URL,
    opts: { proxy?: BrowserProxy; approve?: (url: URL) => Promise<boolean>; browser?: Browser } = {},
  ) {
    const dials: Array<{ host: string; port: number; family: number }> = []
    const proxy =
      opts.proxy ??
      (await BrowserProxy.start(url.protocol === "http:" ? url : "public", {
        connect: (options) => {
          dials.push(options)
          return connect(options)
        },
      }))
    proxies.push(proxy)
    const context = await (opts.browser ?? browser).newContext({
      proxy: proxy.proxy,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
      viewport: { width: 640, height: 480 },
    })
    contexts.push(context)
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(5000)
    page.setDefaultTimeout(5000)
    const blocked: string[] = []
    const approvals: string[] = []
    const logs: unknown[][] = []
    const network = await BrowserNetwork.attach(page, {
      url,
      proxy,
      approve: async (target) => {
        approvals.push(target.href)
        return opts.approve?.(target) ?? false
      },
      blocked: (message) => blocked.push(message),
      log: (...args) => logs.push(args),
    })
    networks.push(network)
    return { page, context, network, proxy, dials, blocked, approvals, logs }
  }

  test("authenticates local HTTP and native WebSockets without exposing proxy credentials", async () => {
    const requests: IncomingMessage[] = []
    const server = createServer((request, response) => {
      requests.push(request)
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Local fixture</title><h1>Ready</h1>")
    })
    const target = await listen(server)
    const sockets = websocket(server)
    const url = new URL(`http://localhost:${target.port}/`)
    const current = await session(url)
    expect((await current.page.goto(url.href))?.status()).toBe(200)
    const echoed = await current.page.evaluate(
      (url) =>
        new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(url)
          socket.onopen = () => socket.send("browser-network")
          socket.onerror = () => reject(new Error("Local WebSocket failed"))
          socket.onmessage = (event) => {
            socket.close()
            resolve(String(event.data))
          }
        }),
      `ws://localhost:${target.port}/socket`,
    )
    expect(echoed).toBe("browser-network")
    expect(current.dials.length).toBeGreaterThan(0)
    expect(current.approvals).toEqual([])
    expect(current.blocked).toEqual([])
    expect(current.network.active).toBe(true)
    expect(requests.length).toBeGreaterThan(0)
    expect(sockets).toHaveLength(1)
    expect([...requests, ...sockets].every((request) => request.headers["proxy-authorization"] === undefined)).toBe(
      true,
    )
  }, 20000)

  test("loads public HTTPS modules from a localhost document without granting public navigation", async () => {
    const assets = await secure("assets", (request, response) => {
      response.writeHead(200, {
        "content-type": "application/javascript",
        "access-control-allow-origin": "*",
      })
      response.end(
        request.url === "/entry.js" ? "export { value } from './nested.js'" : "export const value = 'loaded'",
      )
    })
    const requests: string[] = []
    const source = await listen(
      createServer((request, response) => {
        requests.push(request.url ?? "")
        if (request.url === "/module-api") return response.end("local authority")
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<title>Local modules</title><link rel="icon" href="data:,"><h1>Local page</h1><script type="module">import { value } from '${new URL("/entry.js", assets.url)}'; document.documentElement.dataset.resource = value; document.documentElement.dataset.local = await fetch('/module-api').then(response => response.text());</script>`,
          )
      }),
    )
    const url = new URL(`http://localhost:${source.port}/`)
    const current = await session(url, { proxy: await transport([assets.port], url) })
    await current.page.goto(url.href)
    await current.page.waitForFunction(() => document.documentElement.dataset.local === "local authority", undefined, {
      timeout: 2000,
    })
    expect(await current.page.locator("html").getAttribute("data-resource")).toBe("loaded")
    expect(requests).toContain("/module-api")
    expect(assets.requests.map((request) => request.url)).toEqual(["/entry.js", "/nested.js"])
    expect(current.approvals).toEqual([])
    expect(current.blocked).toEqual([])
    const frame = new URL("/frame", assets.url).href
    const denied = current.page.waitForEvent("requestfailed", (request) => request.url() === frame)
    await current.page.evaluate((url) => {
      const frame = document.createElement("iframe")
      frame.src = url
      document.body.append(frame)
    }, frame)
    expect((await denied).failure()?.errorText).toBe("net::ERR_BLOCKED_BY_CLIENT")
    expect(assets.requests.some((request) => request.url === "/frame")).toBe(false)
    await expect(current.page.goto(new URL("/document", assets.url).href)).rejects.toThrow("ERR_BLOCKED_BY_CLIENT")
    expect(assets.requests.some((request) => request.url === "/document")).toBe(false)
  }, 20000)

  test("a public module redirect cannot contact the approved local origin", async () => {
    const requests: string[] = []
    const source = await listen(
      createServer((request, response) => {
        requests.push(request.url ?? "")
        response.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" })
        response.end('<title>Local redirect test</title><link rel="icon" href="data:,">')
      }),
    )
    const url = new URL(`http://localhost:${source.port}/`)
    const asset = await secure("redirect", (_request, response) => {
      response.writeHead(302, { location: new URL("/from-cdn", url).href, "access-control-allow-origin": "*" }).end()
    })
    const current = await session(url, { proxy: await transport([asset.port], url) })
    await current.page.goto(url.href)
    const contacts = source.contacts()
    expect(
      await current.page.evaluate(
        (url) =>
          import(url).then(
            () => true,
            () => false,
          ),
        asset.url.href,
      ),
    ).toBe(false)
    expect(asset.requests).toHaveLength(1)
    expect(requests).not.toContain("/from-cdn")
    expect(source.contacts()).toBe(contacts)
  }, 20000)

  test.each(["frame", "data-worker", "blob-worker"])(
    "an opaque %s cannot contact the approved local HTTP or WebSocket endpoint",
    async (mode) => {
      const requests: string[] = []
      const server = createServer((request, response) => {
        requests.push(request.url ?? "")
        response
          .writeHead(200, { "content-type": "text/html" })
          .end('<title>Local origin</title><link rel="icon" href="data:,">')
      })
      const source = await listen(server)
      const sockets = websocket(server)
      const url = new URL(`http://localhost:${source.port}/`)
      const current = await session(url)
      await current.page.goto(url.href)
      const contacts = source.contacts()
      const result = await current.page.evaluate(
        async ({ mode, http, ws }) => {
          const probe = async (urls: { http: string; ws: string }) => {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 1000)
            const fetched = fetch(urls.http, { mode: "no-cors", signal: controller.signal })
              .then(
                () => "response",
                () => "blocked",
              )
              .finally(() => clearTimeout(timeout))
            const result = Promise.withResolvers<string>()
            const socket = new WebSocket(urls.ws)
            const timer = setTimeout(() => result.resolve("timeout"), 1000)
            socket.onopen = () => result.resolve("open")
            socket.onerror = () => result.resolve("blocked")
            const connected = await result.promise
            clearTimeout(timer)
            socket.close()
            return { origin: self.origin, fetched: await fetched, connected }
          }
          const call = `(${probe.toString()})(${JSON.stringify({ http, ws })})`
          const script =
            mode === "frame"
              ? `${call}.then(value => parent.postMessage(value, '*'))`
              : `const code = ${JSON.stringify(`${call}.then(value => postMessage(value))`)}; const worker = new Worker(${mode === "data-worker" ? "'data:text/javascript,' + encodeURIComponent(code)" : "URL.createObjectURL(new Blob([code], {type:'application/javascript'}))"}); worker.onmessage = event => { parent.postMessage(event.data, '*'); worker.terminate(); };`
          const frame = document.createElement("iframe")
          frame.sandbox.add("allow-scripts")
          frame.srcdoc = `<script>${script}</script>`
          const done = Promise.withResolvers<{ origin: string; connected: string }>()
          const timer = setTimeout(() => done.reject(new Error("Opaque context probe timed out")), 5000)
          const receive = (event: MessageEvent) => {
            if (event.source === frame.contentWindow) done.resolve(event.data)
          }
          window.addEventListener("message", receive)
          document.body.append(frame)
          return done.promise.finally(() => {
            clearTimeout(timer)
            window.removeEventListener("message", receive)
            frame.remove()
          })
        },
        { mode, http: new URL("/private-fetch", url).href, ws: `ws://${url.host}/private-ws` },
      )
      expect(result.origin).toBe("null")
      expect(result.connected).not.toBe("open")
      expect(requests).not.toContain("/private-fetch")
      expect(sockets).toHaveLength(0)
      expect(source.contacts()).toBe(contacts)
    },
    15000,
  )

  test.each(["http", "https"])(
    "%s origin 401 never receives cached proxy credentials, even with a matching realm",
    async (scheme) => {
      const authorizations: Array<string | undefined> = []
      const state = { realm: "origin" }
      const handle = (request: IncomingMessage, response: ServerResponse) => {
        if (request.url !== "/challenge") {
          response.writeHead(200, { "content-type": "text/html" }).end("<title>Warm proxy authentication</title>")
          return
        }
        authorizations.push(request.headers.authorization)
        response.writeHead(401, { "www-authenticate": `Basic realm="${state.realm}"` }).end("Authentication required")
      }
      const server = scheme === "https" ? https({ key, cert }, handle) : createServer(handle)
      const target = await listen(server)
      const host = scheme === "https" ? "auth.browser.test" : "localhost"
      const url = new URL(`${scheme}://${host}:${target.port}/`)
      const current = await session(url, scheme === "https" ? { proxy: await transport([target.port]) } : {})
      state.realm = current.proxy.credentials.realm
      expect((await current.page.goto(url.href))?.status()).toBe(200)
      const result = await current.page.goto(new URL("/challenge", url).href).then(
        (response) => String(response?.status()),
        (error: Error) => error.message,
      )
      expect(result).toMatch(/401|ERR_INVALID_AUTH_CREDENTIALS|ERR_HTTP_RESPONSE_CODE_FAILURE/)
      expect(authorizations.length).toBeGreaterThan(0)
      expect(authorizations.every((value) => value === undefined)).toBe(true)
      expect(current.network.active).toBe(true)
    },
    20000,
  )

  test.each([
    ["allow", 301],
    ["deny", 301],
    ["allow", 302],
    ["deny", 302],
  ] as const)(
    "%s checks approval at every cross-origin %i redirect hop",
    async (mode, status) => {
      const final = await secure("final", (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" }).end("<title>Final origin</title>")
      })
      const destination = new URL("/final", final.url)
      const middle = await secure("middle", (_request, response) => {
        response.writeHead(status, { location: destination.href }).end()
      })
      const hop = new URL("/hop", middle.url)
      const source = await secure("source", (_request, response) => {
        response.writeHead(status, { location: hop.href }).end()
      })
      const entered = Promise.withResolvers<URL>()
      const decision = Promise.withResolvers<boolean>()
      const current = await session(source.url, {
        proxy: await transport([source.port, middle.port, final.port]),
        approve: async (url) => {
          if (url.origin === middle.url.origin) return true
          entered.resolve(url)
          return decision.promise
        },
      })
      const navigation = current.page.goto(source.url.href).then(
        (response) => ({ status: response?.status(), error: "" }),
        (error: Error) => ({ status: undefined, error: error.message }),
      )
      const requested = await Promise.race([
        entered.promise,
        navigation.then((result) => {
          throw new Error(`Redirect did not pause: ${result.error || result.status}`)
        }),
      ])
      expect(requested.href).toBe(destination.href)
      expect(current.approvals).toEqual([hop.href, destination.href])
      expect(final.requests).toHaveLength(0)
      const committed = current.page.waitForEvent("framenavigated", (frame) => frame === current.page.mainFrame())
      decision.resolve(mode === "allow")
      const result = await navigation
      await committed
      expect(middle.requests.filter((request) => request.url === "/hop")).toHaveLength(1)
      if (mode === "allow") {
        expect(result.status).toBe(200)
        expect(current.page.url()).toBe(destination.href)
        expect(final.requests.filter((request) => request.url === "/final")).toHaveLength(1)
        expect((await current.page.goto(source.url.href))?.status()).toBe(200)
        expect(current.approvals).toEqual([hop.href, destination.href])
        return
      }
      expect(result.error).toContain("ERR_BLOCKED_BY_CLIENT")
      expect(final.requests).toHaveLength(0)
      expect(current.blocked).toEqual([`Navigation to ${final.url.origin} was not approved.`])
      current.network.authorize(destination)
      expect((await current.page.goto(source.url.href))?.status()).toBe(200)
      expect(current.approvals).toEqual([hop.href, destination.href])
    },
    20000,
  )

  test.each(["deny", "allow"] as const)(
    "%s preserves the server's native CORS preflight decision before a credentialed mutation",
    async (mode) => {
      const source = await secure("source", (_request, response) => {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end('<title>Source</title><link rel="icon" href="data:,">')
      })
      const target = await secure("target", (request, response) => {
        if (request.method === "OPTIONS" && mode === "deny") return void response.writeHead(403).end()
        response.writeHead(request.method === "OPTIONS" ? 204 : 200, {
          "access-control-allow-origin": source.url.origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "content-type",
        })
        response.end(request.method === "OPTIONS" ? undefined : "mutated")
      })
      const current = await session(source.url, { proxy: await transport([source.port, target.port]) })
      await current.context.addCookies([
        { url: target.url.href, name: "auth", value: "fixture", httpOnly: true, secure: true, sameSite: "Lax" },
      ])
      await current.page.goto(source.url.href)
      const result = await current.page.evaluate(
        (url) =>
          fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ change: true }),
          }).then(
            (response) => response.text(),
            () => "blocked",
          ),
        new URL("/mutation", target.url).href,
      )
      expect(result).toBe(mode === "allow" ? "mutated" : "blocked")
      const requests = target.requests.filter((request) => request.url === "/mutation")
      expect(requests.map((request) => request.method)).toEqual(mode === "allow" ? ["OPTIONS", "POST"] : ["OPTIONS"])
      expect(requests.at(0)?.headers.cookie).toBeUndefined()
      if (mode === "allow") expect(requests.at(1)?.headers.cookie).toBe("auth=fixture")
      expect(current.approvals).toEqual([])
      expect(current.logs).toEqual([])
    },
    20000,
  )

  test("public cross-origin scripts, frames, fetch and WSS do not grant navigation permission", async () => {
    const assets = await secure("assets", (request, response) => {
      if (request.url === "/script.js") {
        response
          .writeHead(200, { "content-type": "application/javascript" })
          .end("document.documentElement.dataset.resource = 'loaded'")
        return
      }
      if (request.url === "/fetch") {
        response.writeHead(200, { "access-control-allow-origin": "*" }).end("public resource")
        return
      }
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Public resource frame</title>")
    })
    const sockets = websocket(assets.server)
    const source = await secure("source", (_request, response) => {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          `<title>Source origin</title><script src="${new URL("/script.js", assets.url)}"></script><iframe src="${new URL("/frame", assets.url)}"></iframe>`,
        )
    })
    const current = await session(source.url, { proxy: await transport([source.port, assets.port]) })
    await current.page.goto(source.url.href)
    await current.page.waitForFunction(() => document.documentElement.dataset.resource === "loaded")
    expect(
      await current.page.evaluate(
        (url) => fetch(url).then((response) => response.text()),
        new URL("/fetch", assets.url).href,
      ),
    ).toBe("public resource")
    const echoed = await current.page.evaluate(
      (url) =>
        new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(url)
          socket.onopen = () => socket.send("public websocket")
          socket.onerror = () => reject(new Error("Public WSS failed"))
          socket.onmessage = (event) => {
            socket.close()
            resolve(String(event.data))
          }
        }),
      `wss://${assets.url.host}/socket`,
    )
    expect(echoed).toBe("public websocket")
    expect(assets.requests.some((request) => request.url === "/frame")).toBe(true)
    expect(sockets).toHaveLength(1)
    expect(current.approvals).toEqual([])
    const destination = new URL("/document", assets.url)
    await expect(current.page.goto(destination.href)).rejects.toThrow("ERR_BLOCKED_BY_CLIENT")
    expect(current.approvals).toEqual([destination.href])
    expect(assets.requests.some((request) => request.url === "/document")).toBe(false)
  }, 20000)

  test("tracks nested out-of-process frames and closes one context without changing another", async () => {
    const isolated = await launch(true, ["--site-per-process"])
    cleanup.push(() => isolated.close())
    const leaf = await secure("leaf", (request, response) => {
      response.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" })
      response.end(
        request.url === "/fetch"
          ? "worker resource"
          : request.url === "/container"
            ? '<iframe src="/"></iframe>'
            : "<h1>Nested frame</h1>",
      )
    })
    const outer = await secure("outer", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end(`<iframe src="${leaf.url}"></iframe>`)
    })
    outer.url.hostname = "8.8.8.8"
    const source = await secure("source", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end(`<iframe src="${outer.url}"></iframe>`)
    })
    const ports = [source.port, outer.port, leaf.port]
    const [current, other] = await Promise.all([
      session(source.url, { browser: isolated, proxy: await transport(ports) }),
      session(source.url, { browser: isolated, proxy: await transport(ports) }),
    ])
    await Promise.all([current.page.goto(source.url.href), other.page.goto(source.url.href)])
    const nested = current.page.frameLocator("iframe").frameLocator("iframe").locator("h1")
    await nested.waitFor()
    expect(await nested.textContent()).toBe("Nested frame")
    const frame = current.page.frames().find((frame) => frame.url() === outer.url.href)
    if (!frame) throw new Error("Missing out-of-process fixture frame")
    const protocol = await current.context.newCDPSession(frame)
    expect((await protocol.send("Target.getTargetInfo")).targetInfo.type).toBe("iframe")
    await protocol.detach()
    const result = await frame.evaluate(async (url) => {
      const code = `fetch(${JSON.stringify(url)}).then(response => response.text()).then(value => postMessage(value), () => postMessage('blocked'))`
      const source = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
      const worker = new Worker(source)
      const result = Promise.withResolvers<string>()
      worker.onmessage = (event) => result.resolve(String(event.data))
      worker.onerror = () => result.resolve("failed")
      return result.promise.finally(() => {
        worker.terminate()
        URL.revokeObjectURL(source)
      })
    }, new URL("/fetch", leaf.url).href)
    expect(result).toBe("worker resource")
    for (const url of [new URL("/container", leaf.url).href, outer.url.href]) {
      const count = leaf.requests.filter((request) => request.url === "/").length
      const navigated = current.page.waitForEvent("framenavigated", (frame) => frame.url() === url)
      await current.page.locator("iframe").evaluate((frame, url) => frame.setAttribute("src", url), url)
      await navigated
      if (url === outer.url.href) await nested.waitFor()
      if (url !== outer.url.href) {
        const parent = current.page.frames().find((frame) => frame.url() === url)
        if (!parent) throw new Error("Missing fixture frame after the process swap")
        await parent.waitForFunction(() => {
          const doc = document.querySelector("iframe")?.contentDocument
          const heading = doc?.querySelector("h1")
          if (!heading || doc?.readyState !== "complete") return false
          const rect = heading.getBoundingClientRect()
          return (
            heading.textContent === "Nested frame" &&
            getComputedStyle(heading).visibility === "visible" &&
            rect.width > 0 &&
            rect.height > 0
          )
        })
      }
      expect(leaf.requests.filter((request) => request.url === "/")).toHaveLength(count + 1)
    }
    expect(
      await frame.evaluate((url) => fetch(url).then((response) => response.text()), new URL("/fetch", leaf.url).href),
    ).toBe("worker resource")
    const detached = current.page.waitForEvent("framedetached", (value) => value === frame)
    await current.page.evaluate(() => document.querySelector("iframe")?.remove())
    await detached
    expect(current.network.active).toBe(true)
    await current.page.reload()
    await nested.waitFor()
    await Promise.all([current.network.close(), current.context.close()])
    expect(current.network.active).toBe(false)
    expect((await other.page.reload())?.status()).toBe(200)
    await other.page.frameLocator("iframe").frameLocator("iframe").locator("h1").waitFor()
    expect(other.network.active).toBe(true)
    expect(current.approvals).toEqual([])
    expect(other.approvals).toEqual([])
    expect(current.logs).toEqual([])
    expect(other.logs).toEqual([])
    await isolated.close()
    expect(other.network.active).toBe(false)
    await expect(fetch(other.proxy.proxy.server)).rejects.toThrow()
  }, 20000)

  test.each(["direct", "noopener", "blank", "new-page"])(
    "blocks the first %s popup HTTPS request with cached proxy auth and a warm connection",
    async (mode) => {
      const target = await secure("popup", (_request, response) => {
        response.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" })
        response.end("<title>Unapproved popup</title>")
      })
      const destination = new URL("/first-request", target.url)
      const script =
        mode === "blank"
          ? `window.open('about:blank').location = '${destination.href}'`
          : `window.open('${destination.href}', '_blank', '${mode === "noopener" ? "noopener" : ""}')`
      const source = await secure("source", (_request, response) => {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<button>Open popup</button><script>document.querySelector('button').onclick = () => { ${script} }</script>`,
          )
      })
      const current = await session(source.url, { proxy: await transport([source.port, target.port]) })
      await current.context.addCookies([
        { url: target.url.href, name: "popup", value: "fixture", httpOnly: true, secure: true, sameSite: "Lax" },
      ])
      expect((await current.page.goto(source.url.href))?.status()).toBe(200)
      await current.page.evaluate(
        (url) => fetch(url).then((response) => response.text()),
        new URL("/warm", target.url).href,
      )
      const finished = Promise.withResolvers<string | undefined>()
      const complete = (request: Request) => {
        if (request.url() === destination.href) finished.resolve(request.failure()?.errorText)
      }
      current.context.on("requestfinished", complete)
      current.context.on("requestfailed", complete)
      const opened = current.context.waitForEvent("page")
      if (mode === "new-page") {
        const page = await current.context.newCDPSession(current.page)
        const { targetInfo: owner } = await page.send("Target.getTargetInfo")
        await page.detach()
        const monitor = await browser.newBrowserCDPSession()
        await monitor.send("Target.createTarget", { url: destination.href, browserContextId: owner.browserContextId })
        await monitor.detach()
      }
      if (mode !== "new-page") await current.page.getByRole("button", { name: "Open popup" }).click()
      const popup = await opened
      if (mode === "new-page") {
        await popup.waitForLoadState("domcontentloaded")
        const page = await current.context.newCDPSession(popup)
        const tree = await page.send("Page.getFrameTree")
        expect(tree.frameTree.frame.unreachableUrl).toBe(destination.href)
        await page.detach()
      }
      if (mode !== "new-page") expect(await finished.promise).toBe("net::ERR_BLOCKED_BY_CLIENT")
      await popup.close()
      current.context.off("requestfinished", complete)
      current.context.off("requestfailed", complete)
      expect(target.requests.map((request) => request.url)).toEqual(["/warm"])
      expect(current.approvals).toEqual([])
      expect(current.network.active).toBe(true)
      expect(current.logs).toEqual([])
      expect((await current.page.reload())?.status()).toBe(200)
    },
    20000,
  )

  test("expires pending broker approval without blaming the server or allowing a late response", async () => {
    const target = await secure("approval", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Unapproved target</title>")
    })
    const source = await secure("source", (_request, response) => {
      response.writeHead(301, { location: target.url.href }).end()
    })
    const proxy = await transport([source.port, target.port])
    proxies.push(proxy)
    const entered = Promise.withResolvers<void>()
    const decision = Promise.withResolvers<boolean>()
    const settled = Promise.withResolvers<boolean>()
    const logs: unknown[][] = []
    const broker = new BrowserBroker({
      log: (...args) => logs.push(args),
      launch: async () => ({
        newContext: async (opts) => {
          const context = await browser.newContext({ ...opts, proxy: proxy.proxy })
          contexts.push(context)
          return context
        },
        close: async () => undefined,
      }),
      network: async (page, opts) => {
        const network = await BrowserNetwork.attach(page, {
          ...opts,
          proxy,
          approve: async (url) => {
            const allowed = await opts.approve(url)
            settled.resolve(allowed)
            return allowed
          },
        })
        networks.push(network)
        return network
      },
    })
    cleanup.push(() => broker.disposeAsync())
    broker.bind(
      (route) => route,
      async () => {
        entered.resolve()
        return decision.promise
      },
    )
    const route = { projectId: "project", sessionId: "approval", directory: "/tmp/project" }
    const navigation = broker.open(route, source.url.href).then(
      () => "loaded",
      (error: Error) => error.message,
    )
    await entered.promise
    expect(target.requests).toHaveLength(0)
    const error = await navigation
    expect(error).toBe(
      "Browser navigation stopped while waiting for approval in VS Code. Dismiss the approval prompt and retry.",
    )
    expect(broker.get(route.sessionId, route.projectId)).toMatchObject({ status: "error", error })
    expect(networks.at(-1)?.active).toBe(false)
    decision.resolve(true)
    expect(await settled.promise).toBe(false)
    expect(target.requests).toHaveLength(0)
    await expect(fetch(proxy.proxy.server)).rejects.toThrow()
    expect(logs).toEqual([])
  }, 45000)

  test("retires routing and pending approvals without leaving cached proxy access", async () => {
    const target = await secure("retired", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Unapproved destination</title>")
    })
    const source = await secure("source", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Source</title>")
    })
    const entered = Promise.withResolvers<void>()
    const decision = Promise.withResolvers<boolean>()
    const current = await session(source.url, {
      proxy: await transport([source.port, target.port]),
      approve: async () => {
        entered.resolve()
        return decision.promise
      },
    })
    const waiting = Promise.withResolvers<void>()
    const permission = Promise.withResolvers<boolean>()
    const other = await session(source.url, {
      proxy: await transport([source.port, target.port]),
      approve: async () => {
        waiting.resolve()
        return permission.promise
      },
    })
    expect((await current.page.goto(source.url.href))?.status()).toBe(200)
    expect((await other.page.goto(source.url.href))?.status()).toBe(200)
    const navigation = current.page.goto(target.url.href).then(
      () => "loaded",
      (error: Error) => error.message,
    )
    await Promise.race([
      entered.promise,
      navigation.then((result) => {
        throw new Error(`Navigation did not pause: ${result}`)
      }),
    ])
    const pending = other.page.goto(new URL("/survivor", target.url).href).then(
      (response) => response?.status(),
      (error: Error) => error.message,
    )
    await waiting.promise
    await current.network.close()
    expect(await navigation).toContain("ERR_BLOCKED_BY_CLIENT")
    expect(current.network.active).toBe(false)
    expect(target.requests).toHaveLength(0)
    permission.resolve(true)
    expect(await pending).toBe(200)
    decision.resolve(true)
    expect(target.requests.some((request) => request.url === "/")).toBe(false)
    const contacts = source.contacts()
    await expect(current.page.goto(new URL("/after-close", source.url).href)).rejects.toThrow()
    expect(source.requests.some((request) => request.url === "/after-close")).toBe(false)
    expect(source.contacts()).toBe(contacts)
    expect((await other.page.reload())?.status()).toBe(200)
    expect(other.network.active).toBe(true)
    expect(current.logs).toEqual([])
  }, 20000)

  test("certificate errors remain errors without the fixture-only certificate pin", async () => {
    const source = await secure("untrusted", (_request, response) => response.end("must not load"))
    const untrusted = await launch(false)
    cleanup.push(() => untrusted.close())
    const current = await session(source.url, { browser: untrusted, proxy: await transport([source.port]) })
    await expect(current.page.goto(source.url.href)).rejects.toThrow("ERR_CERT_")
    expect(source.requests).toHaveLength(0)
    expect(source.contacts()).toBeGreaterThan(0)
  }, 20000)

  test.skipIf(process.env.KILO_BROWSER_GOOGLE_SMOKE !== "1").each(["google.com", "www.google.com"])(
    "Google HTTPS manual probe: %s",
    async (host) => {
      const external = await launch(false)
      cleanup.push(() => external.close())
      const url = new URL(`https://${host}/`)
      const current = await session(url, {
        browser: external,
        approve: async (target) => ["https://www.google.com", "https://consent.google.com"].includes(target.origin),
      })
      const response = await current.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 20000 }).then(
        (response) => ({ status: response?.status(), error: undefined }),
        (error: Error) => ({ status: undefined, error: error.message }),
      )
      expect({ ...response, approvals: current.approvals, blocked: current.blocked, logs: current.logs }).toMatchObject(
        {
          status: 200,
          error: undefined,
          blocked: [],
          logs: [],
        },
      )
      if (host === "google.com") {
        expect(current.approvals.some((url) => new URL(url).origin === "https://www.google.com")).toBe(true)
      }
      expect(await current.page.title()).toContain("Google")
      expect(current.network.active).toBe(true)
    },
    30000,
  )

  test.skipIf(process.env.KILO_BROWSER_GOOGLE_SMOKE !== "1")(
    "Google broker navigation probe",
    async () => {
      const logs: unknown[][] = []
      const approvals: string[] = []
      const broker = new BrowserBroker({
        log: (...args) => logs.push(args),
        useSystemChrome: () => false,
        launch: (config) => chromium.launch({ ...config, executablePath: executable }),
      })
      cleanup.push(() => broker.disposeAsync())
      const views = new Set<string>()
      const streaming: Promise<void>[] = []
      broker.subscribe((state) => {
        if (state.status !== "loading" || views.has(state.browserId)) return
        views.add(state.browserId)
        streaming.push(
          broker.viewport(state.sessionId, state.projectId, state.browserId, state.navigation, {
            width: 640,
            height: 480,
            revision: 1,
            active: true,
          }),
        )
      })
      const route = { projectId: "project", sessionId: "google", directory: "/tmp/project" }
      broker.bind(
        (scope) => scope,
        async (_scope, url) => {
          approvals.push(url.origin)
          return ["https://www.google.com", "https://consent.google.com"].includes(url.origin)
        },
      )
      const local = await listen(
        createServer((_request, response) => {
          response.writeHead(200, { "content-type": "text/html" }).end("<title>Local fixture</title>")
        }),
      )
      expect((await broker.open(route, `http://127.0.0.1:${local.port}/`)).status).toBe("ready")
      for (const url of ["https://google.com/", "https://www.google.com/", "https://google.com/"]) {
        const state = await broker.open(route, url)
        expect(state.status).toBe("ready")
        expect(state.title).toContain("Google")
        expect(state.screenshot).toStartWith("data:image/jpeg;base64,")
        expect(state.error).toBeUndefined()
      }
      await Promise.all(streaming)
      expect(approvals).toContain("https://www.google.com")
      expect(logs).toEqual([])
    },
    60000,
  )

  test("remote pages and workers make no forbidden loopback TCP or UDP contact", async () => {
    const sentinel = await listen(tcp((socket) => socket.destroy()))
    const datagrams = createSocket("udp4")
    const traffic = { packets: 0 }
    datagrams.on("message", () => traffic.packets++)
    const ready = once(datagrams, "listening")
    datagrams.bind(0, "127.0.0.1")
    await ready
    const port = datagrams.address().port
    cleanup.push(() => new Promise<void>((resolve) => datagrams.close(() => resolve())))
    const source = await secure("source", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Remote source</title>")
    })
    const current = await session(source.url, { proxy: await transport([source.port]) })
    await current.page.goto(source.url.href)
    expect(await current.page.evaluate(() => isSecureContext)).toBe(true)
    for (const offline of [false, true]) {
      if (offline) await current.proxy.close()
      const result = await current.page.evaluate(
        async ({ tcp, udp }) => {
          const bounded = async (promise: Promise<string>) => {
            const expired = Promise.withResolvers<string>()
            const timer = setTimeout(() => expired.resolve("timeout"), 1500)
            return Promise.race([promise, expired.promise]).finally(() => clearTimeout(timer))
          }
          const fetches = async (url: string) => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 1500)
            return fetch(url, { mode: "no-cors", signal: controller.signal })
              .then(
                () => "loaded",
                () => "blocked",
              )
              .finally(() => clearTimeout(timer))
          }
          const socket = async (url: string) => {
            const result = Promise.withResolvers<string>()
            const value = new WebSocket(url)
            value.onopen = () => result.resolve("open")
            value.onerror = () => result.resolve("blocked")
            return bounded(result.promise).finally(() => value.close())
          }
          const worker = async () => {
            const url = URL.createObjectURL(
              new Blob(
                [
                  "onmessage = event => fetch(event.data, { mode: 'no-cors' }).then(() => postMessage('loaded'), () => postMessage('blocked'))",
                ],
                { type: "application/javascript" },
              ),
            )
            const value = new Worker(url)
            const result = Promise.withResolvers<string>()
            value.onmessage = (event) => result.resolve(String(event.data))
            value.onerror = () => result.resolve("blocked")
            value.postMessage(`https://loop.browser.test:${tcp}/worker`)
            return bounded(result.promise).finally(() => {
              value.terminate()
              URL.revokeObjectURL(url)
            })
          }
          const rtc = async () => {
            if (typeof RTCPeerConnection === "undefined") return "unavailable"
            const result = Promise.withResolvers<string>()
            const peer = new RTCPeerConnection({
              iceServers: [
                { urls: `stun:127.0.0.1:${udp}` },
                {
                  urls: [`turn:127.0.0.1:${tcp}?transport=tcp`, `turns:127.0.0.1:${tcp}?transport=tcp`],
                  username: "fixture",
                  credential: "fixture",
                },
              ],
            })
            peer.onicegatheringstatechange = () => {
              if (peer.iceGatheringState === "complete") result.resolve("complete")
            }
            peer.createDataChannel("probe")
            await peer.setLocalDescription(await peer.createOffer())
            return bounded(result.promise).finally(() => peer.close())
          }
          const transport = async () => {
            if (typeof WebTransport === "undefined") return "unavailable"
            const value = new WebTransport(`https://127.0.0.1:${udp}/probe`)
            void value.closed.catch(() => "blocked")
            return bounded(
              value.ready.then(
                () => "open",
                () => "blocked",
              ),
            ).finally(() => value.close())
          }
          return Promise.all([
            fetches(`http://127.0.0.1:${tcp}/http`),
            fetches(`https://127.0.0.1:${tcp}/https`),
            fetches(`https://loop.browser.test:${tcp}/dns`),
            socket(`ws://127.0.0.1:${tcp}/ws`),
            socket(`wss://127.0.0.1:${tcp}/wss`),
            worker(),
            rtc(),
            transport(),
          ])
        },
        { tcp: sentinel.port, udp: port },
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(result).not.toContain("loaded")
      expect(result).not.toContain("open")
      expect(result).not.toContain("unavailable")
      expect(sentinel.contacts()).toBe(0)
      expect(traffic.packets).toBe(0)
    }
  }, 20000)

  test("a failed proxy does not fall back to direct loopback HTTP or WebSocket connections", async () => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url ?? "")
      response.writeHead(200, { "content-type": "text/html" }).end("<title>Local fixture</title>")
    })
    const target = await listen(server)
    const sockets = websocket(server)
    const url = new URL(`http://localhost:${target.port}/`)
    const current = await session(url)
    await current.page.goto(url.href)
    await current.proxy.close()
    const contacts = target.contacts()
    const outcome = await current.page.evaluate(
      (url) =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(url)
          socket.onopen = () => {
            socket.close()
            resolve("open")
          }
          socket.onerror = () => resolve("error")
        }),
      `ws://localhost:${target.port}/after-close`,
    )
    expect(outcome).toBe("error")
    await expect(current.page.goto(new URL("/after-close", url).href)).rejects.toThrow()
    expect(requests).not.toContain("/after-close")
    expect(sockets).toHaveLength(0)
    expect(target.contacts()).toBe(contacts)
  }, 20000)
})
