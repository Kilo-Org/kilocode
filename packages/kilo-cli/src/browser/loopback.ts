// Loopback mode: the extension dials a WebSocket on 127.0.0.1 after reading the
// pairing key from a page this server hands to the browser.
import http from "node:http"
import { WebSocketServer, WebSocket, type RawData } from "ws"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { Log } from "./log"
import * as proto from "./protocol"
import { PeerLimit } from "./frame"
import { Paths } from "./paths"
import { Registry } from "./registry"
import { create, type Extension, type Hub } from "./hub"
import { serve } from "./socket"
import { allowlist, ids } from "./install"
import * as pair from "./pair"

const log = Log.create({ service: "browser.loopback" })

const HandshakeTimeout = 10_000
const IdleExit = 10 * 60_000
// Longest a shutdown waits for connections to drain before giving up on them.
const ShutdownGrace = 2_000
const Hosts = ["127.0.0.1", "localhost", "::1"]

export type Trust = {
  origin?: string
  host?: string
  allowed: string[]
}

// Only a loopback Host and an extension Origin may open the socket. A web page can
// reach 127.0.0.1 too, so the Origin is the check that matters.
//
// Firefox reports `moz-extension://<random per-profile uuid>`, not the add-on's
// Gecko ID, so the origin cannot be pinned to the one Kilo extension the way the
// Chromium branch pins it to the store ID. A Gecko ID sent later in the handshake
// would be self-reported and no stronger than the URL the peer already controls, so
// Firefox relies on the HMAC over the 32-byte pairing key; the origin check only
// keeps web pages and non-extension schemes out.
const MozUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function trusted(input: Trust) {
  const host = input.host?.trim()
  if (!host) return false
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : (host.split(":")[0] ?? "")
  if (!Hosts.includes(name)) return false
  const origin = input.origin?.trim().replace(/\/$/, "")
  if (!origin) return false
  if (origin.startsWith("moz-extension://")) return MozUuid.test(origin.slice("moz-extension://".length))
  const chrome = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  return chrome !== null && chrome[1] !== undefined && input.allowed.includes(chrome[1])
}

// `new URL` throws on an empty or malformed Host header, so every request path goes
// through here and a bad request never reaches an uncaught exception.
function requestUrl(request: { url?: string; headers: { host?: string | string[] } }, fallback: string) {
  const raw = request.headers.host
  const host = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : fallback
  try {
    return new URL(request.url ?? "/", `http://${host}`)
  } catch (error) {
    log.warn("dropping a loopback request with an unusable URL", { url: request.url, host: raw, error })
    return undefined
  }
}

function text(data: RawData) {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}

function parse(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch (error) {
    log.warn("dropping a loopback frame that is not valid JSON", { error })
    return undefined
  }
}

// The whole pairing request body is `{"t":"<16-byte token>"}`; nothing legitimate is
// larger, so the cap is what keeps an anonymous loopback caller from making the hub
// buffer an arbitrary amount before the origin check would even matter.
const ExchangeBodyLimit = 1024

// Anything that is not that one object with a well-formed token is malformed, and a
// malformed request must leave the token redeemable.
function parseExchange(input: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return undefined
  }
  const parsed = pair.Redeem.safeParse(value)
  if (!parsed.success || !pair.decode(parsed.data.t, pair.TokenBytes)) return undefined
  return parsed.data.t
}

// Resolves with the body text, or undefined when it exceeded `limit`; the caller
// answers 400 in both the cap and the malformed case.
function read(request: http.IncomingMessage, limit: number): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>()
  const chunks: Buffer[] = []
  let size = 0
  let done = false
  const finish = (value: string | undefined) => {
    if (done) return
    done = true
    resolve(value)
  }
  request.on("data", (chunk: Buffer) => {
    if (done) return
    size += chunk.length
    if (size > limit) {
      // Stop buffering once over the cap; the stream keeps flowing and discards.
      finish(undefined)
      return
    }
    chunks.push(chunk)
  })
  request.on("end", () => finish(Buffer.concat(chunks).toString("utf8")))
  request.on("error", () => finish(undefined))
  return promise
}

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Kilo browser pairing</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#e8e8ea;font:16px/1.5 system-ui,sans-serif}
main{max-width:32rem;padding:2rem}
h1{font-size:1.25rem;margin:0 0 1rem}
p{margin:0 0 .75rem;color:#b6b6bd}
a{color:#8ab4ff}
</style></head>
<body><main>
<h1>Pairing the Kilo browser extension&hellip;</h1>
<p>Keep this tab open for a moment. The extension reads the pairing key from this page, stores it, and closes the tab.</p>
<p>If nothing happens, check that the Kilo extension is installed and that its &ldquo;Allow local agents&rdquo; switch is on.</p>
<p><a href="${proto.StoreUrl}">Install the Kilo browser extension</a></p>
</main></body></html>
`

export type Run = {
  port?: number
  host?: string
  version?: string
  idleMs?: number
  // How long a minted pairing token stays redeemable; tests shorten it.
  pairingTtlMs?: number
}

export type Running = {
  port: number
  hubId: string
  // Resolves when the hub stopped, for any reason.
  done: Promise<void>
  stop(): Promise<void>
}

export async function run(input: Run = {}): Promise<Running> {
  const port = input.port ?? proto.DefaultPort
  const host = input.host ?? "127.0.0.1"
  const version = input.version ?? OPENCODE_VERSION
  const idleMs = input.idleMs ?? IdleExit
  const ttl = input.pairingTtlMs ?? pair.PairingTtl
  const key = await pair.load()
  // Same source as native mode: the persisted allowlist, which `install-host` writes
  // and a browser started from its GUI session needs, then the environment.
  const allowed = (await allowlist()) ?? ids()
  // When nothing is attached or connected, the window is measured from the last
  // activity, not from process start.
  const activity = { at: Date.now() }
  const touch = () => {
    activity.at = Date.now()
  }

  // Pairing tokens minted for this hub. A CLI asks for one over the per-user socket
  // (0700, same user only) and the extension redeems it once for the key here, so the
  // durable key never appears in the opener's argv.
  const tokens = new Map<string, number>()
  function mint() {
    const now = Date.now()
    for (const [value, expires] of tokens) if (expires <= now) tokens.delete(value)
    const token = pair.nonce(pair.TokenBytes)
    tokens.set(token, now + ttl)
    return token
  }
  function redeem(token: string) {
    const expires = tokens.get(token)
    if (expires === undefined) return false
    tokens.delete(token)
    return expires > Date.now()
  }

  const hub: Hub = create({
    mode: "loopback",
    version,
    local(method) {
      if (method !== "pairing.url") return undefined
      touch()
      return { url: pair.url({ port: entry.port ?? port, hubId: hub.id, token: mint() }) }
    },
    onChange(info) {
      touch()
      void Registry.write({
        ...entry,
        browser: info?.browser ?? null,
        profileLabel: info?.profileLabel ?? null,
      }).catch((error) => log.warn("cannot update the hub registry entry", { error }))
    },
  })
  const entry = Registry.empty({ hubId: hub.id, mode: "loopback", socket: Paths.socket(hub.id) })

  const server = http.createServer((request, response) => {
    // No touch() here: an unauthenticated web page must not be able to keep a
    // detached hub alive with a polling fetch. The idle guard already counts an
    // upgrade socket and the handshake timeout covers the pre-auth window.
    const url = requestUrl(request, host)
    if (!url || url.pathname !== pair.PairingPath) {
      if (url?.pathname === pair.PairingKeyPath) {
        exchange(request, response)
        return
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      response.end("not found")
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    response.end(page)
  })

  // The extension's only new step: hand back the fragment token in a JSON POST and
  // receive the key. The origin gate is the same one the WebSocket upgrade uses, so
  // a web page that reaches 127.0.0.1 cannot redeem a token it guessed or minted for
  // itself.
  //
  // It is a POST because a Chrome MV3 service worker's GET carries no Origin header,
  // and the origin is the only thing separating the extension from a web page. The
  // JSON content type also forces a CORS preflight, so the browser asks before the
  // body is sent.
  function exchange(request: http.IncomingMessage, response: http.ServerResponse) {
    const origin = request.headers.origin?.trim()
    if (!origin || !trusted({ origin, host: request.headers.host, allowed })) {
      log.warn("refusing a pairing key exchange", { origin, host: request.headers.host })
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
      response.end("forbidden")
      return
    }
    // An allowlisted origin may read the status, so the extension can tell a 404
    // (ask the CLI for a new pairing page) from a 403 (not this extension's hub).
    const cors = { "access-control-allow-origin": origin, "cache-control": "no-store" }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type",
      })
      response.end()
      return
    }
    if (request.method !== "POST") {
      response.writeHead(405, {
        ...cors,
        allow: "POST, OPTIONS",
        "content-type": "text/plain; charset=utf-8",
      })
      response.end("method not allowed")
      return
    }
    void read(request, ExchangeBodyLimit).then((text) => {
      // An oversized body reads as malformed: the cap is exactly the reason.
      const parsed = text === undefined ? undefined : parseExchange(text)
      if (parsed === undefined) {
        response.writeHead(400, { ...cors, "content-type": "text/plain; charset=utf-8" })
        response.end("bad request")
        return
      }
      // Redeeming is what burns the token, so every refusal above leaves it usable.
      if (!redeem(parsed)) {
        response.writeHead(404, { ...cors, "content-type": "text/plain; charset=utf-8" })
        response.end("not found")
        return
      }
      const body: pair.KeyExchange = { v: 1, key, ws: pair.ws(entry.port ?? port) }
      response.writeHead(200, { ...cors, "content-type": "application/json" })
      response.end(JSON.stringify(body))
    })
  }
  // Without this, an accept-level error (EMFILE, for example) on a long-lived hub
  // reaches no listener and becomes an uncaught exception.
  server.on("error", (error) => log.error("loopback server error", { error }))

  const wss = new WebSocketServer({ noServer: true, maxPayload: PeerLimit })
  server.on("upgrade", (request, socket, head) => {
    // Unauthenticated too: only a connection that passed the origin check (the
    // connection handler) refreshes the idle window.
    const url = requestUrl(request, host)
    if (!url || url.pathname !== pair.SocketPath) {
      socket.destroy()
      return
    }
    if (!trusted({ origin: request.headers.origin, host: request.headers.host, allowed })) {
      log.warn("refusing a loopback upgrade", { origin: request.headers.origin, host: request.headers.host })
      socket.write("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws))
  })

  wss.on("connection", (ws) => {
    touch()
    const nonceH = pair.nonce()
    const state: { sink?: Extension; timer?: NodeJS.Timeout } = {}
    const send = (frame: proto.HubToExtension) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify(frame))
      return true
    }
    const hello: proto.HubHello = {
      type: "hub.hello",
      protocol: [proto.Protocol],
      hubVersion: version,
      mode: "loopback",
    }

    state.timer = setTimeout(() => {
      log.warn("loopback handshake timed out")
      ws.close(4408, "handshake timeout")
    }, HandshakeTimeout)
    ws.send(JSON.stringify({ type: "challenge", nonceH } satisfies proto.Challenge))

    ws.on("message", (data) => {
      touch()
      // A frame that does not parse or does not match the phase ends the connection.
      const value = parse(text(data))
      if (state.sink === undefined) {
        const auth = proto.Auth.safeParse(value)
        if (!auth.success || auth.data.hubId !== hub.id || !pair.decode(auth.data.nonceE, pair.NonceBytes)) {
          log.warn("refusing a loopback handshake")
          ws.close(4401, "bad handshake")
          return
        }
        if (!pair.equal(pair.extensionMac(key, nonceH, auth.data.nonceE), auth.data.mac)) {
          log.warn("refusing a loopback handshake with a bad MAC")
          ws.close(4401, "bad mac")
          return
        }
        clearTimeout(state.timer)
        ws.send(
          JSON.stringify({ type: "auth_ok", mac: pair.hubMac(key, nonceH, auth.data.nonceE) } satisfies proto.AuthOk),
        )
        // The CLI opens the pairing page only while the hub reports that it was
        // never paired, so record the first successful handshake in the registry.
        if (!entry.paired) {
          entry.paired = true
          void Registry.write(entry).catch((error) => log.warn("cannot record the pairing in the registry", { error }))
        }
        // hub.hello is the first frame after auth_ok, even when this transport is
        // about to be refused because another extension already owns the hub.
        send(hello)
        const sink = hub.attach(send, (reason) => ws.close(4403, reason))
        if (!sink) return
        state.sink = sink
        return
      }
      const parsed = proto.ExtensionToHub.safeParse(value)
      if (!parsed.success) {
        log.warn("closing a loopback connection that sent an invalid frame", { issues: parsed.error.issues })
        state.sink.drop()
        ws.close(4400, "invalid frame")
        return
      }
      if (parsed.data.type === "ext.hello") state.sink.hello(parsed.data)
      else state.sink.frame(parsed.data)
    })

    ws.on("close", () => {
      touch()
      clearTimeout(state.timer)
      state.sink?.drop()
    })
    ws.on("error", (error) => log.warn("loopback socket error", { error }))
  })

  const listening = Promise.withResolvers<number>()
  server.once("error", listening.reject)
  server.listen(port, host, () => {
    server.removeListener("error", listening.reject)
    const address = server.address()
    listening.resolve(typeof address === "object" && address !== null ? address.port : port)
  })
  const bound = await listening.promise
  // The registry is what lets a CLI build the pairing URL, so record the port the
  // browser must reach.
  entry.port = bound

  const socket = await serve({
    path: entry.socket,
    open(connection) {
      touch()
      const controller = hub.join(
        (frame) => connection.send(frame),
        () => connection.close(),
      )
      connection.onClose(() => {
        touch()
        controller.drop()
      })
      return (frame) => controller.frame(frame)
    },
  })
  await Registry.write(entry)

  const stopping = { done: false }
  // Resolved when the hub is stopped, so a caller that awaits done stays alive.
  const finished = Promise.withResolvers<void>()
  async function stop() {
    if (stopping.done) return
    stopping.done = true
    clearInterval(idle)
    hub.close("the hub is shutting down")
    // `server.close()` alone waits for keep-alive HTTP connections and peers that
    // ignore the WebSocket close frame, so terminate them and bound the wait.
    for (const client of wss.clients) client.terminate()
    wss.close()
    const closed = Promise.withResolvers<void>()
    server.close(() => closed.resolve())
    if (typeof server.closeAllConnections === "function") server.closeAllConnections()
    const drained = await Promise.race([closed.promise.then(() => true), Bun.sleep(ShutdownGrace).then(() => false)])
    if (!drained) log.warn("the loopback server did not close within the shutdown grace period")
    const graceful = socket.close().catch((error) => log.warn("cannot close the CLI socket", { error }))
    await Promise.race([graceful, Bun.sleep(ShutdownGrace)])
    await Registry.remove(entry.hubId).catch((error) => log.warn("cannot remove the hub registry entry", { error }))
    finished.resolve()
  }

  // A detached hub must not outlive its usefulness: exit once nothing is attached
  // and nothing has been for the whole idle window.
  const idle = setInterval(
    () => {
      // A controller or a transport that is still handshaking counts as activity,
      // even before `ext.hello` makes the extension visible. `wss.clients` also
      // covers a socket that has not completed authentication yet.
      if (hub.count() > 0 || hub.attached() || wss.clients.size > 0) {
        touch()
        return
      }
      if (Date.now() - activity.at < idleMs) return
      log.info("exiting an idle loopback hub")
      void stop()
    },
    Math.min(30_000, Math.max(1_000, Math.floor(idleMs / 4))),
  )
  idle.unref()

  log.info("loopback hub listening", { port: bound, hubId: hub.id })
  return { port: bound, hubId: hub.id, done: finished.promise, stop }
}
