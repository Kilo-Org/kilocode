// Loopback mode: the extension dials a WebSocket on 127.0.0.1 after reading the
// pairing key from a page this server hands to the browser.
import http from "node:http"
import { WebSocketServer, WebSocket, type RawData } from "ws"
import { Log } from "@opencode-ai/core/util/log"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as proto from "./protocol"
import { PeerLimit } from "./frame"
import { Paths } from "./paths"
import { Registry } from "./registry"
import { create, type Extension, type Hub } from "./hub"
import { serve } from "./socket"
import { ids } from "./install"
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
  exit?: (code: number) => void
}

export async function run(input: Run = {}) {
  const port = input.port ?? proto.DefaultPort
  const host = input.host ?? "127.0.0.1"
  const version = input.version ?? InstallationVersion
  const idleMs = input.idleMs ?? IdleExit
  const leave = input.exit ?? ((code: number) => process.exit(code))
  const key = await pair.load()
  const allowed = ids()
  // When nothing is attached or connected, the window is measured from the last
  // activity, not from process start.
  const activity = { at: Date.now() }
  const touch = () => {
    activity.at = Date.now()
  }

  const hub: Hub = create({
    mode: "loopback",
    version,
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
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      response.end("not found")
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    response.end(page)
  })
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
  const signals = { term: () => void stop(0), int: () => void stop(0) }
  // Resolved when the hub is stopped, so a caller that awaits run() stays alive.
  const finished = Promise.withResolvers<void>()
  async function stop(code: number) {
    if (stopping.done) return
    stopping.done = true
    clearInterval(idle)
    process.removeListener("SIGTERM", signals.term)
    process.removeListener("SIGINT", signals.int)
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
    leave(code)
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
      void stop(0)
    },
    Math.min(30_000, Math.max(1_000, Math.floor(idleMs / 4))),
  )

  log.info("loopback hub listening", { port: bound, hubId: hub.id })
  process.once("SIGTERM", signals.term)
  process.once("SIGINT", signals.int)
  return finished.promise
}
