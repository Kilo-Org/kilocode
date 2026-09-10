import { afterAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { connect } from "node:net"
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startWebServer, type WebHost } from "../src/web-server"

// Real loopback upstream: an actual HTTP server with scripted behavior and hit
// accounting, so the tests prove proxy behavior rather than mocks.
let upstreamHits = 0
const upstreamAuthSeen: string[] = []
const streamListeners = new Set<() => void>()

const upstream: Server = createServer((req, res) => {
  upstreamHits++
  if (req.headers.authorization !== basicUpstream) {
    res.statusCode = 401
    res.end("upstream unauthorized")
    return
  }
  if (req.url === "/api/health") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ healthy: true }))
    return
  }
  if (req.url?.startsWith("/api/event")) {
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    res.write("event: ping\ndata: 1\n\n")
    streamListeners.add(() => {
      res.write("event: ping\ndata: 2\n\n")
      res.end()
    })
    const drop = () => streamListeners.clear()
    req.on("aborted", drop)
    req.on("close", drop)
    res.on("close", drop)
    return
  }
  res.statusCode = 404
  res.end("not found")
})

const basicUpstream = `Basic ${Buffer.from("opencode:server-secret").toString("base64")}`

let upstreamPort = 0
await new Promise<void>((resolveListen) => upstream.listen(0, "127.0.0.1", () => resolveListen()))
upstreamPort = (upstream.address() as { port: number }).port

const assetsDir = realpathSync(mkdtempSync(path.join(tmpdir(), "kilo-web-host-")))
mkdirSync(path.join(assetsDir, "assets"), { recursive: true })
writeFileSync(path.join(assetsDir, "index.html"), "<html><body>app</body></html>")
writeFileSync(path.join(assetsDir, "assets", "app-abc.js"), "console.log(1)")
writeFileSync(path.join(assetsDir, "assets", "secret.js"), "console.log('inside')")
symlinkSync(path.join(assetsDir, "assets", "app-abc.js"), path.join(assetsDir, "link-ok.js"))
symlinkSync(new URL("../src/web-server.ts", import.meta.url).pathname, path.join(assetsDir, "link-escape.js"))

const hosts: WebHost[] = []

async function startHost(): Promise<WebHost> {
  const host = await import("../src/web-server").then((m) =>
    m.startWebServer({
      assets: assetsDir,
      serverUrl: `http://127.0.0.1:${upstreamPort}`,
      serverPassword: "server-secret",
    }),
  )
  hosts.push(host)
  return host
}

function authed(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
}

afterAll(async () => {
  await Promise.all(hosts.map((host) => host.close()))
  upstream.close()
  await rm(assetsDir, { recursive: true, force: true })
})

describe("kilo vscode local web host", () => {
  test("rejects non-loopback upstreams at construction", async () => {
    const failure = await import("../src/web-server").then((m) =>
      m
        .startWebServer({
          assets: assetsDir,
          serverUrl: "https://example.invalid",
          serverPassword: "x",
        })
        .catch((error: Error) => error.message),
    )
    expect(await failure).toContain("loopback")
  })

  test("refuses unauthenticated api requests before any upstream hit", async () => {
    const host = await startHost()
    const before = upstreamHits
    const withoutAuth = await fetch(`${host.url}/api/health`)
    expect(withoutAuth.status).toBe(401)
    const wrongAuth = await fetch(`${host.url}/api/health`, { headers: authed("wrong-password") })
    expect(wrongAuth.status).toBe(401)
    expect(upstreamHits).toBe(before)
  })

  test("proxies authenticated api traffic with the real upstream credential", async () => {
    const host = await startHost()
    const response = await fetch(`${host.url}/api/health`, { headers: authed(host.password) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ healthy: true })
  })

  test("streams server-sent events progressively and aborts upstream on client abort", async () => {
    const host = await startHost()
    const controller = new AbortController()
    const response = await fetch(`${host.url}/api/event`, {
      headers: { ...authed(host.password), accept: "text/event-stream" },
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain("data: 1")
    const aborted = new Promise<void>((resolveAborted) => {
      const timer = setInterval(() => {
        if (streamListeners.size === 0) {
          clearInterval(timer)
          resolveAborted()
        }
      }, 20)
      setTimeout(() => {
        clearInterval(timer)
        resolveAborted()
      }, 4000)
    })
    await controller.abort()
    await aborted
    expect(streamListeners.size).toBe(0)
  })

  test("serves static assets, spa fallback, and refuses traversal and symlink escapes", async () => {
    const host = await startHost()
    const page = await fetch(`${host.url}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toContain("text/html")
    expect(await page.text()).toContain("app")

    const asset = await fetch(`${host.url}/assets/app-abc.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get("content-type")).toContain("text/javascript")

    const spa = await fetch(`${host.url}/session/ses_0123456789abcdef`)
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain("app")

    const traversal = await fetch(`${host.url}/../../etc/passwd`)
    // Bun's fetch normalizes dot segments before sending, so this lands as an
    // unknown SPA route; the served body must never contain outside content.
    expect(traversal.status).toBe(200)
    expect(await traversal.text()).not.toContain("root:")

    // Raw-socket traversal (no client or library URL normalization) must be refused outright.
    const rawTraversal = await rawRequest(host, "/../../etc/passwd")
    expect(rawTraversal.status).toBe(403)

    // Bun's fetch decodes percent-encoded dot segments client-side too; the
    // byte-exact encoded probe must hit the server's own 403 refusal.
    const encoded = await rawRequest(host, "/%2e%2e/%2e%2e/etc/passwd")
    expect(encoded.status).toBe(403)

    const symlinkEscape = await fetch(`${host.url}/link-escape.js`, { headers: authed(host.password) })
    expect(symlinkEscape.status === 403 || symlinkEscape.status === 404).toBe(true)

    const symlinkInside = await fetch(`${host.url}/link-ok.js`)
    expect(symlinkInside.status).toBe(200)

    const missingAsset = await fetch(`${host.url}/assets/missing-123.js`)
    expect(missingAsset.status).toBe(404)
  })

  test("terminal upgrades enforce origin, path, and ticket guards before upstream work", async () => {
    const host = await startHost()
    const before = upstreamHits

    // 1. Missing ticket fails with 403 before upstream
    const noTicket = await rawRequest(
      host,
      "/api/pty/example/connect",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    expect(noTicket.status).toBe(403)
    expect(upstreamHits).toBe(before)

    // 2. Foreign origin fails with 403 before upstream
    const foreignOrigin = await rawRequest(
      host,
      "/api/pty/example/connect?ticket=t1",
      "Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://malicious.example.com",
    )
    expect(foreignOrigin.status).toBe(403)
    expect(upstreamHits).toBe(before)

    // 3. Missing origin fails with 403 before upstream
    const noOrigin = await rawRequest(
      host,
      "/api/pty/example/connect?ticket=t1",
      "Connection: Upgrade\r\nUpgrade: websocket",
    )
    expect(noOrigin.status).toBe(403)
    expect(upstreamHits).toBe(before)

    // 4. Disallowed path fails with 403 before upstream
    const badPath = await rawRequest(
      host,
      "/api/session/connect?ticket=t1",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    expect(badPath.status).toBe(403)
    expect(upstreamHits).toBe(before)

    // 5. Non-origin-form (absolute URI) request targets fail with 400 before upstream
    const absoluteTarget = await rawRequest(
      host,
      "http://evil.com/api/pty/example/connect?ticket=t1",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    expect(absoluteTarget.status).toBe(400)
    expect(upstreamHits).toBe(before)
  })

  test("registered webview origins upgrade without forwarding their origin upstream", async () => {
    // A dedicated upstream records exactly what arrives on the WS upgrade.
    let forwardedHeaders: Record<string, string | string[] | undefined> = {}
    let upstreamUpgrades = 0
    const upstreamUpgraded = Promise.withResolvers<void>()
    const relay: Server = createServer((_req, res) => res.end())
    relay.on("upgrade", (req, socket) => {
      forwardedHeaders = { ...req.headers }
      upstreamUpgrades++
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
      socket.destroy()
      upstreamUpgraded.resolve()
    })
    await new Promise<void>((resolveListen) => relay.listen(0, "127.0.0.1", () => resolveListen()))
    const relayPort = (relay.address() as { port: number }).port
    const host = await startWebServer({
      assets: assetsDir,
      serverUrl: `http://127.0.0.1:${relayPort}`,
      serverPassword: "server-secret",
    })
    hosts.push(host)

    const webviewOrigin = "https://vscode-webview-webview-0123abcd.vscode-cdn.net"
    const connectPath = "/api/pty/example/connect?ticket=t1"

    // An unregistered vscode-webview-shaped origin fails before any upstream work.
    const unregistered = await rawUpgrade(host, connectPath, webviewOrigin)
    expect(unregistered.status).toBe(403)
    expect(upstreamUpgrades).toBe(0)

    // Registering the panel origin lets the upgrade through, but the client Origin must
    // never reach the native server: the consumed ticket + location scope own authority.
    const disposeA = host.allowOrigin(webviewOrigin)
    const first = await rawUpgrade(host, connectPath, webviewOrigin)
    expect(first.status).toBe(101)
    await upstreamUpgraded.promise
    expect(forwardedHeaders.authorization).toBeUndefined()
    expect(forwardedHeaders["proxy-authorization"]).toBeUndefined()
    expect(forwardedHeaders.origin).toBeUndefined()
    expect(forwardedHeaders.host).toBe(`127.0.0.1:${relayPort}`)
    expect(JSON.stringify(forwardedHeaders)).not.toContain("server-secret")

    // Repeated panels reference-count the same origin; one disposer keeps it allowed.
    const disposeB = host.allowOrigin(webviewOrigin)
    disposeA()
    const second = await rawUpgrade(host, connectPath, webviewOrigin)
    expect(second.status).toBe(101)
    expect(upstreamUpgrades).toBe(2)

    // Last disposer removes the origin: unknown origins never reach upstream again.
    disposeB()
    const afterDispose = await rawUpgrade(host, connectPath, webviewOrigin)
    expect(afterDispose.status).toBe(403)
    expect(upstreamUpgrades).toBe(2)

    // The host's own loopback origins keep working and forward their origin as before.
    const loopback = await rawUpgrade(host, connectPath, host.url)
    expect(loopback.status).toBe(101)
    expect(upstreamUpgrades).toBe(3)

    // Malformed registrations fail fast instead of silently never matching.
    expect(() => host.allowOrigin("not an origin")).toThrow("malformed webview origin")
  })

  test("close() stops the listener and drops in-flight upstream work", async () => {
    const host = await startHost()
    const response = await fetch(`${host.url}/api/event`, {
      headers: authed(host.password),
    })
    expect(response.status).toBe(200)
    await response.body!.cancel()
    await host.close()
    const after = await fetch(`${host.url}/api/health`).catch((error: Error) => error)
    expect(after).toBeInstanceOf(Error)
  })
})

// WebSocket upgrade probe over a raw socket; resolves as soon as the response head
// arrives (the socket is destroyed either way — 101 keeps streaming after resolve).
function rawUpgrade(
  host: WebHost,
  requestPath: string,
  origin: string,
): Promise<{ status: number }> {
  return new Promise((resolveProbe, rejectProbe) => {
    const port = Number(new URL(host.url).port)
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`,
      )
    })
    let head = ""
    socket.on("data", (chunk: Buffer) => {
      head += String(chunk)
      if (!head.includes("\r\n\r\n")) return
      const status = Number(head.split(" ")[1] ?? 0)
      socket.destroy()
      resolveProbe({ status })
    })
    socket.on("error", rejectProbe)
  })
}

// Byte-exact request over a raw socket: no client-side or library URL normalization.
function rawRequest(
  host: WebHost,
  requestPath: string,
  headers = "Connection: close",
): Promise<{ status: number; body: string }> {
  return new Promise((resolveProbe, rejectProbe) => {
    const port = Number(new URL(host.url).port)
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}\r\n\r\n`)
    })
    let raw = ""
    socket.on("data", (chunk: Buffer) => {
      raw += String(chunk)
    })
    socket.on("close", () => {
      const status = Number(raw.split(" ")[1] ?? 0)
      const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n")
      resolveProbe({ status, body })
    })
    socket.on("error", rejectProbe)
  })
}
