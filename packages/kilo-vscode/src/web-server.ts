import {
  createServer,
  request,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { timingSafeEqual } from "node:crypto"
import { createReadStream, realpathSync, statSync } from "node:fs"
import { dirname, extname, join, normalize, resolve, sep } from "node:path"
import { randomBytes } from "node:crypto"

/** Real path of the deepest existing ancestor; missing suffixes rejoin virtually. */
function deepestRealPath(candidate: string): string {
  let probe = candidate
  let remainder = ""
  while (true) {
    try {
      return join(realpathSync(probe), remainder)
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return join(realpathSync(probe), remainder)
      remainder = join(probe.split(sep).at(-1) ?? "", remainder)
      probe = parent
    }
  }
}

/**
 * Local-only web host for the v2 app assets embedded in a VS Code webview iframe.
 *
 * The browser (iframe) receives a fresh preview password; its v2 client sends Basic auth with
 * it exactly like it would against the real server. The host validates that header on every
 * /api request, then re-signs the upstream request with the ACTUAL server password — the real
 * credential never reaches the browser. Only /api/* is proxied, only to the fixed verified
 * loopback upstream given at construction; static/SPA serving is contained to the fixed assets
 * directory (traversal and symlink escapes are refused). HTTP only — the upstream is a local
 * v2 server on loopback, so no TLS options exist.
 */

export interface WebHost {
  /** http://127.0.0.1:<port> — the URL the iframe loads the app from. */
  readonly url: string
  /** Preview password; the browser's v2 client sends Basic "opencode:<password>". */
  readonly password: string
  /**
   * Allow an exact webview origin (e.g. the per-panel `https://vscode-webview-webview-<uuid>.vscode-cdn.net`
   * the panel reports through the trusted postMessage channel) to open terminal WebSocket
   * upgrades. The origin is reference-counted for repeated panels; the returned disposer
   * removes one registration. Validated origins are never forwarded upstream — the upstream
   * upgrade is ticket-authoritative and carries no client Origin.
   */
  allowOrigin(origin: string): () => void
  /** Stops the listener, destroys open connections and in-flight upstream work. */
  close(): Promise<void>
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
}

function timingSafeMatch(presented: string | undefined, expected: string): boolean {
  if (!presented?.startsWith("Basic ")) return false
  const decoded = Buffer.from(presented.slice("Basic ".length).trim(), "base64").toString("utf8")
  const separator = decoded.indexOf(":")
  if (separator === -1) return false
  const actual = Buffer.from(decoded.slice(separator + 1))
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

/** Hop-by-hop headers are never copied between the two HTTP sides. */
function withoutHopByHop(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const cleaned = { ...headers }
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    delete cleaned[name]
  }
  return cleaned
}

export async function startWebServer(input: {
  /** Fixed assets directory (the built v2 app). Never escapes it. */
  readonly assets: string
  readonly serverUrl: string
  readonly serverPassword: string
}): Promise<WebHost> {
  const upstreamUrl = new URL(input.serverUrl)
  if (!isLoopback(upstreamUrl)) {
    throw new Error(`upstream must be a loopback http URL, received ${input.serverUrl}`)
  }
  if (!input.serverPassword) throw new Error("upstream server password is required")
  const assetsRoot = resolve(input.assets)
  const upstreamAuthorization = basicAuth("opencode", input.serverPassword)
  const previewPassword = randomBytes(24).toString("base64url")

  // In-flight proxied requests; each leaves the set when its upstream response
  // ends, errors, or is torn down by a client disconnect.
  const upstreamSessions = new Set<ClientRequest>()

  const proxyApi = (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/"
    if (!rawUrl.startsWith("/")) {
      res.statusCode = 400
      res.end()
      return
    }
    const target = new URL(rawUrl, upstreamUrl)
    const headers = withoutHopByHop({ ...req.headers })
    delete headers.authorization
    delete headers.host
    // The browser presented the preview credential; upstream sees the real one.
    headers.authorization = upstreamAuthorization

    let upstreamRequest: ClientRequest | undefined
    let finished = false
    const socketListeners: Array<() => void> = []
    const detachSocketListeners = () => {
      for (const detach of socketListeners) detach()
      socketListeners.length = 0
    }
    const release = () => {
      if (finished || !upstreamRequest) return
      finished = true
      if (upstreamRequest) upstreamSessions.delete(upstreamRequest)
      detachSocketListeners()
      upstreamRequest.destroy()
      upstreamRequest = undefined
    }
    // Node fires req close after the request body completes — that is a normal
    // mid-response state, not a disconnect. Real client disconnects surface as
    // res close with an unwritten response (Node) or the raw socket close (Bun,
    // which emits neither req nor res close on a mid-stream abort).
    res.on("close", () => {
      if (res.writableEnded) {
        finished = true
        if (upstreamRequest) upstreamSessions.delete(upstreamRequest)
        detachSocketListeners()
        return
      }
      release()
    })
    req.on("aborted", () => release())
    socketListeners.push(() => {})
    const socketCloseHandler = () => release()
    req.socket.on("close", socketCloseHandler)
    socketListeners.push(() => req.socket.off("close", socketCloseHandler))

    upstreamRequest = request(target, { method: req.method, headers }, (upstreamResponse) => {
      if (res.writableEnded || res.destroyed) {
        upstreamResponse.destroy()
        return
      }
      const responseHeaders = withoutHopByHop({ ...upstreamResponse.headers })
      delete responseHeaders["content-length"]
      res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(res)
      upstreamResponse.on("end", () => {
        finished = true
        if (upstreamRequest) upstreamSessions.delete(upstreamRequest)
        detachSocketListeners()
      })
      upstreamResponse.on("error", () => {
        finished = true
        if (upstreamRequest) upstreamSessions.delete(upstreamRequest)
        detachSocketListeners()
        res.destroy()
      })
    })
    upstreamSessions.add(upstreamRequest)
    upstreamRequest.on("error", (error) => {
      finished = true
      if (upstreamRequest) upstreamSessions.delete(upstreamRequest)
      detachSocketListeners()
      if (!res.headersSent) {
        res.statusCode = 502
        res.end(`web host: upstream request failed: ${error instanceof Error ? error.message : String(error)}`)
      } else {
        res.destroy()
      }
    })
    req.pipe(upstreamRequest)
    // A GET with no body still needs the upstream request flushed.
    if (req.method === "GET" || req.method === "HEAD") upstreamRequest.end()
  }

  const serveAsset = (req: IncomingMessage, res: ServerResponse, requestPath: string) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405
      res.end()
      return
    }
    // Parse the raw request path manually: both the WHATWG URL constructor and
    // HTTP clients collapse dot segments, which would turn a traversal probe
    // into a harmless-looking path instead of a refusal.
    const rawPath = (requestPath ?? "/").split("?")[0]
    let pathname: string
    try {
      pathname = decodeURIComponent(rawPath)
    } catch {
      res.statusCode = 400
      res.end()
      return
    }
    if (pathname.includes("\0")) {
      res.statusCode = 400
      res.end()
      return
    }
    if (pathname.split("/").includes("..")) {
      res.statusCode = 403
      res.end()
      return
    }
    const target = resolve(assetsRoot, `.${normalize(pathname)}`)
    if (target !== assetsRoot && !target.startsWith(assetsRoot + sep)) {
      res.statusCode = 403
      res.end()
      return
    }
    let filePath = target
    try {
      const stats = statSync(filePath)
      if (stats.isDirectory()) filePath = join(filePath, "index.html")
    } catch {
      // SPA fallback: extension-less document routes are served by index.html.
      const lastSegment = pathname.split("/").filter(Boolean).at(-1) ?? ""
      if (extname(lastSegment) === "") {
        filePath = join(assetsRoot, "index.html")
      } else {
        res.statusCode = 404
        res.end()
        return
      }
    }
    // Symlink containment: the REAL path (symlinks fully resolved) must stay
    // inside the real assets root — plain resolve() does not follow symlinks.
    let realPath: string
    try {
      realPath = realpathSync(filePath)
    } catch {
      realPath = deepestRealPath(filePath)
    }
    const realRoot = realpathSync(assetsRoot)
    if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
      res.statusCode = 403
      res.end()
      return
    }
    if (extname(filePath) === "") {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader("Content-Type", MIME_TYPES[extname(filePath)] ?? "application/octet-stream")
    res.setHeader("Cache-Control", filePath === resolve(assetsRoot, "index.html") ? "no-store" : "public, max-age=3600")
    const stream = createReadStream(filePath)
    stream.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 404
        res.end()
      } else {
        res.destroy()
      }
    })
    if (req.method === "HEAD") {
      res.setHeader("Content-Length", statSync(filePath).size)
      res.end()
      stream.destroy()
      return
    }
    stream.pipe(res)
  }

  const server: Server = createServer((req, res) => {
    const requestPath = req.url ?? "/"
    if (requestPath === "/api" || requestPath.startsWith("/api/")) {
      if (!timingSafeMatch(req.headers.authorization, previewPassword)) {
        // Refuse before any upstream work: a failed request never reaches the server.
        res.statusCode = 401
        res.setHeader("WWW-Authenticate", 'Basic realm="kilo-preview"')
        res.end()
        return
      }
      proxyApi(req, res)
      return
    }
    serveAsset(req, res, requestPath)
  })

  const PTY_CONNECT_PATH = /^\/api\/pty\/[^/]+\/connect$/
  const PERSISTENT_PTY_CONNECT_PATH = /^\/api\/experimental\/persistent-pty\/[^/]+\/connect$/
  const activeSockets = new Set<Socket>()
  /** Exact webview origins registered through allowOrigin(), with per-origin reference counts. */
  const registeredOrigins = new Map<string, number>()
  const allowOrigin = (origin: string): (() => void) => {
    const trimmed = origin.trim()
    if (!trimmed || !URL.canParse(trimmed) || new URL(trimmed).origin !== trimmed)
      throw new Error(`Refusing to register a malformed webview origin: ${JSON.stringify(origin)}`)
    registeredOrigins.set(trimmed, (registeredOrigins.get(trimmed) ?? 0) + 1)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const remaining = (registeredOrigins.get(trimmed) ?? 0) - 1
      if (remaining <= 0) registeredOrigins.delete(trimmed)
      else registeredOrigins.set(trimmed, remaining)
    }
  }

  // Native v2 terminal WebSocket ticket path:
  // 1. Authenticated HTTP connect-token issuance happens via /api through the preview proxy.
  // 2. WebSocket upgrade requires the host's own loopback Origin, a registered webview Origin,
  //    an allowed terminal connect path, and a ticket.
  // 3. MUST NOT inject real server Authorization — upstream ticket validation owns authority.
  //    Registered webview Origins are validated here and then removed: the native connect
  //    handler only accepts loopback Origins, so a forwarded vscode-webview Origin would be
  //    refused even though the ticket itself is valid.
  server.on("upgrade", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    activeSockets.add(clientSocket)
    const cleanupClient = () => {
      activeSockets.delete(clientSocket)
      clientSocket.destroy()
    }
    clientSocket.on("close", cleanupClient)
    clientSocket.on("error", cleanupClient)

    const rawUrl = req.url ?? "/"
    // Fixed-loopback invariant: reject non-origin-form request targets before parsing.
    if (!rawUrl.startsWith("/")) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }

    const addr = server.address() as AddressInfo | null
    const port = addr?.port
    if (!port) {
      clientSocket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }

    const requestUrl = new URL(rawUrl, `http://127.0.0.1:${port}`)
    const pathname = requestUrl.pathname
    const ticket = requestUrl.searchParams.get("ticket")

    // 1. Verify path is an allowed terminal connect path
    const isAllowedPath = PTY_CONNECT_PATH.test(pathname) || PERSISTENT_PTY_CONNECT_PATH.test(pathname)
    if (!isAllowedPath) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }

    // 2. Verify ticket is present and non-empty (upstream ticket validation owns authority)
    if (!ticket || ticket.trim() === "") {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }

    // 3. Verify a trusted Origin: the host's own loopback origins, or an exact webview origin
    // registered through allowOrigin() (reference-counted; the extension registers the per-panel
    // origin it receives through the trusted postMessage channel).
    const origin = req.headers.origin
    const expectedOrigin1 = `http://127.0.0.1:${port}`
    const expectedOrigin2 = `http://localhost:${port}`
    const ownLoopback = origin === expectedOrigin1 || origin === expectedOrigin2
    if (!origin || (!ownLoopback && !registeredOrigins.has(origin))) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }

    // 4. Construct target strictly from parsed pathname/search on the fixed upstreamUrl;
    // never inject real server Authorization (upstream ticket validation owns authority).
    const target = new URL(requestUrl.pathname + requestUrl.search, upstreamUrl)
    const upstreamHeaders = withoutHopByHop({ ...req.headers })
    delete upstreamHeaders.authorization
    delete upstreamHeaders["proxy-authorization"]
    delete upstreamHeaders.host
    upstreamHeaders.host = upstreamUrl.host
    // Registered non-loopback webview Origins must never reach the native server: it accepts
    // loopback Origins only, and the consumed ticket + location scope own the authority.
    if (ownLoopback) upstreamHeaders.origin = origin
    else delete upstreamHeaders.origin
    upstreamHeaders.connection = req.headers.connection ?? "Upgrade"
    upstreamHeaders.upgrade = req.headers.upgrade ?? "websocket"

    const upstreamReq = request(target, {
      method: "GET",
      headers: upstreamHeaders,
    })

    upstreamSessions.add(upstreamReq)
    const cleanupUpstreamReq = () => {
      upstreamSessions.delete(upstreamReq)
    }

    upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      cleanupUpstreamReq()
      if (clientSocket.destroyed) {
        upstreamSocket.destroy()
        return
      }
      activeSockets.add(upstreamSocket)
      const cleanupUpstream = () => {
        activeSockets.delete(upstreamSocket)
        upstreamSocket.destroy()
      }
      upstreamSocket.on("close", cleanupUpstream)
      upstreamSocket.on("error", cleanupUpstream)

      // Send 101 Switching Protocols with upstream headers
      const statusLine = `HTTP/1.1 101 Switching Protocols\r\n`
      const headerLines: string[] = []
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) headerLines.push(`${key}: ${v}`)
        } else if (value !== undefined) {
          headerLines.push(`${key}: ${value}`)
        }
      }
      clientSocket.write(statusLine + headerLines.join("\r\n") + "\r\n\r\n")

      if (upstreamHead && upstreamHead.length > 0) clientSocket.write(upstreamHead)
      if (head && head.length > 0) upstreamSocket.write(head)

      clientSocket.pipe(upstreamSocket)
      upstreamSocket.pipe(clientSocket)
    })

    upstreamReq.on("response", (upstreamRes) => {
      cleanupUpstreamReq()
      if (clientSocket.destroyed) return
      const statusLine = `HTTP/1.1 ${upstreamRes.statusCode ?? 502} ${upstreamRes.statusMessage ?? "Error"}\r\n`
      const headerLines: string[] = ["Connection: close"]
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (key.toLowerCase() === "connection") continue
        if (Array.isArray(value)) {
          for (const v of value) headerLines.push(`${key}: ${v}`)
        } else if (value !== undefined) {
          headerLines.push(`${key}: ${value}`)
        }
      }
      clientSocket.write(statusLine + headerLines.join("\r\n") + "\r\n\r\n")
      upstreamRes.pipe(clientSocket)
    })

    upstreamReq.on("error", () => {
      cleanupUpstreamReq()
      if (!clientSocket.destroyed) {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      }
    })

    upstreamReq.end()
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("web host failed to bind a TCP port")

  let closed: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${address.port}`,
    password: previewPassword,
    allowOrigin,
    close() {
      closed ??= new Promise<void>((resolveClose) => {
        for (const session of [...upstreamSessions]) session.destroy()
        upstreamSessions.clear()
        for (const sock of [...activeSockets]) sock.destroy()
        activeSockets.clear()
        registeredOrigins.clear()
        server.close(() => resolveClose())
        server.closeAllConnections()
      })
      return closed
    },
  }
}
