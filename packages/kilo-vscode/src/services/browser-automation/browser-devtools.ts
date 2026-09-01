import { randomBytes, timingSafeEqual } from "node:crypto"
import { request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { URL } from "node:url"
import WebSocket, { WebSocketServer, type RawData } from "ws"

type Target = {
  browser: string
  page: string
  port: number
  secret: string
  theme: "dark" | "light"
  expires: number
  sockets: Set<WebSocket>
  inspecting: Set<WebSocket>
}

type Match = { target: Target; path: string }
type Message = { method?: string; params?: { mode?: string } }

const LIFETIME = 15 * 60 * 1000
const PAYLOAD = 16 * 1024 * 1024

function equal(left: string, right: string): boolean {
  const actual = Buffer.from(left)
  const expected = Buffer.from(right)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function resource(port: number, path: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > PAYLOAD) {
          response.destroy(new Error("Browser developer tools asset exceeds the size limit"))
          return
        }
        chunks.push(chunk)
      })
      response.once("error", reject)
      response.once("end", () =>
        resolve({ status: response.statusCode ?? 502, headers: response.headers, body: Buffer.concat(chunks) }),
      )
    })
    req.setTimeout(10_000, () => req.destroy(new Error("Browser developer tools asset request timed out")))
    req.once("error", reject)
    req.end()
  })
}

function inspect(data: RawData): Message | undefined {
  const value = Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf8")
      : data.toString("utf8")
  if (!value.includes("Overlay.")) return
  try {
    const message = JSON.parse(value) as Message
    return typeof message.method === "string" ? message : undefined
  } catch {
    return undefined
  }
}

export class BrowserDevtools {
  private readonly targets = new Map<string, Target>()
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: PAYLOAD })
  private readonly upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.connect(req, socket, head)
  }

  constructor(
    private readonly server: Server,
    private readonly port: number,
    private readonly log: (...args: unknown[]) => void,
    private readonly mode: (browser: string, active: boolean) => void,
  ) {
    this.server.on("upgrade", this.upgrade)
  }

  open(browser: string, page: string, port: number, theme: "dark" | "light"): string {
    this.revoke(browser)
    const secret = randomBytes(32).toString("hex")
    const target: Target = {
      browser,
      page,
      port,
      secret,
      theme,
      expires: Date.now() + LIFETIME,
      sockets: new Set(),
      inspecting: new Set(),
    }
    this.targets.set(browser, target)
    const path = `/browser/devtools/${browser}/${secret}`
    const query = new URLSearchParams({
      ws: `127.0.0.1:${this.port}${path}/connect`,
    })
    return `http://127.0.0.1:${this.port}${path}/inspector.html?${query}`
  }

  async handle(req: IncomingMessage, res: ServerResponse, route: URL): Promise<boolean> {
    if (!route.pathname.startsWith("/browser/devtools/")) return false
    const scope = this.match(req, route)
    if (!scope || req.method !== "GET" || scope.path === "connect") {
      res.writeHead(scope ? 405 : 401, { "cache-control": "no-store" })
      res.end()
      return true
    }
    if (scope.path === "kilo-bootstrap.js") {
      const script = [
        `localStorage.setItem("ui-theme",JSON.stringify(${JSON.stringify(scope.target.theme)}))`,
        'localStorage.setItem("currentDockState",JSON.stringify("undocked"))',
      ].join(";")
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(script),
        "content-type": "application/javascript; charset=utf-8",
      })
      res.end(script)
      return true
    }
    try {
      const response = await resource(scope.target.port, `/devtools/${scope.path}${route.search}`)
      const data = response.body
      const body =
        scope.path === "inspector.html" && response.status === 200
          ? Buffer.from(
              data
                .toString("utf8")
                .replace(
                  /<script\s+type="module"/i,
                  '<script src="./kilo-bootstrap.js"></script><script type="module"',
                ),
            )
          : data
      const headers: Record<string, string | number> = {
        "cache-control": "no-store",
        "content-length": body.byteLength,
        "referrer-policy": "no-referrer",
      }
      for (const name of ["content-type", "content-security-policy"]) {
        const value = response.headers[name]
        if (typeof value === "string") headers[name] = value
      }
      res.writeHead(response.status, headers)
      res.end(body)
    } catch (error) {
      this.log("Browser developer tools asset failed", { browser: scope.target.browser, error })
      res.writeHead(502, { "cache-control": "no-store" })
      res.end()
    }
    return true
  }

  revoke(browser: string): void {
    const target = this.targets.get(browser)
    if (!target) return
    this.targets.delete(browser)
    if (target.inspecting.size) this.mode(browser, false)
    target.inspecting.clear()
    for (const socket of target.sockets) socket.close(1001, "Browser session closed")
    target.sockets.clear()
  }

  dispose(): void {
    this.server.off("upgrade", this.upgrade)
    for (const browser of [...this.targets.keys()]) this.revoke(browser)
    this.sockets.close()
  }

  private match(req: IncomingMessage, route: URL): Match | undefined {
    if (req.headers.host !== `127.0.0.1:${this.port}`) return
    const parts = route.pathname.split("/")
    if (parts[1] !== "browser" || parts[2] !== "devtools" || parts.length < 6) return
    const target = this.targets.get(parts[3])
    if (!target || target.expires < Date.now() || !equal(parts[4], target.secret)) return
    const path = parts.slice(5).join("/")
    if (!path || path.includes("..") || path.includes("\\") || /%2f|%5c/i.test(path)) return
    target.expires = Date.now() + LIFETIME
    return { target, path }
  }

  private connect(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const route = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`)
    const scope = this.match(req, route)
    if (!scope || scope.path !== "connect") return reject(socket, 401, "Unauthorized")
    if (req.headers.origin !== `http://127.0.0.1:${this.port}`) return reject(socket, 403, "Forbidden")
    this.sockets.handleUpgrade(req, socket, head, (client) => this.bridge(scope.target, client))
  }

  private select(target: Target, client: WebSocket, active: boolean): void {
    const previous = target.inspecting.size > 0
    if (active) target.inspecting.add(client)
    if (!active) target.inspecting.delete(client)
    const current = target.inspecting.size > 0
    if (previous !== current) this.mode(target.browser, current)
  }

  private bridge(target: Target, client: WebSocket): void {
    const upstream = new WebSocket(`ws://127.0.0.1:${target.port}/devtools/page/${target.page}`, {
      maxPayload: PAYLOAD,
    })
    const queued: Array<{ data: RawData; binary: boolean }> = []
    target.sockets.add(client)

    const close = () => {
      this.select(target, client, false)
      target.sockets.delete(client)
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close()
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
    }

    upstream.on("open", () => {
      for (const item of queued.splice(0)) upstream.send(item.data, { binary: item.binary })
    })
    upstream.on("message", (data, binary) => {
      const message = inspect(data)
      if (message?.method === "Overlay.inspectNodeRequested" || message?.method === "Overlay.inspectModeCanceled") {
        this.select(target, client, false)
      }
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
    })
    upstream.on("error", (error) => {
      this.log("Browser developer tools connection failed", { browser: target.browser, error })
      close()
    })
    upstream.on("close", close)
    client.on("message", (data, binary) => {
      const message = inspect(data)
      if (message?.method === "Overlay.setInspectMode") {
        this.select(
          target,
          client,
          message.params?.mode === "searchForNode" || message.params?.mode === "searchForUAShadowDOM",
        )
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary })
        return
      }
      if (upstream.readyState === WebSocket.CONNECTING) queued.push({ data, binary })
    })
    client.on("error", (error) => {
      this.log("Browser developer tools client failed", { browser: target.browser, error })
      close()
    })
    client.on("close", close)
  }
}
