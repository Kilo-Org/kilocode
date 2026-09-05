import { isPublicAddress } from "@kilocode/sandbox/destination"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { lookup } from "node:dns/promises"
import { once } from "node:events"
import {
  createServer,
  request as send,
  validateHeaderName,
  validateHeaderValue,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { connect, isIP, type Socket } from "node:net"
import type { Duplex } from "node:stream"
import { parse } from "./browser-policy"

interface Options {
  lookup?: (host: string, signal: AbortSignal) => Promise<readonly { address: string; family: number }[]>
  connect?: (options: { host: string; port: number; family: 4 | 6 }) => Socket
  timeout?: number
}

const LIMIT = 16 * 1024

function authority(value: string, scheme: "http" | "https") {
  if (!/^(?:\[[\da-f:]+\]|[^\s:/?#@\\]+):\d+$/i.test(value)) {
    throw new TypeError("Invalid proxy authority")
  }
  return parse(`${scheme}://${value}/`)
}

function headers(input: IncomingHttpHeaders, host?: string) {
  const blocked = new Set([
    "connection",
    "proxy-connection",
    "proxy-authorization",
    "proxy-authenticate",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    ...(input.connection ?? "").split(",").map((value) => value.trim().toLowerCase()),
  ])
  return {
    ...Object.fromEntries(
      Object.entries(input).filter(([name, value]) => value !== undefined && !blocked.has(name.toLowerCase())),
    ),
    ...(host ? { host } : {}),
  }
}

function local(request: IncomingMessage, url: URL) {
  const fields = request.headers
  if (fields.origin !== undefined && fields.origin !== url.origin) {
    throw new Error("Local browser request origin is not approved")
  }
  if (fields["sec-fetch-site"] === "same-origin") return
  if (
    fields["sec-fetch-site"] === "none" &&
    fields["sec-fetch-mode"] === "navigate" &&
    fields["sec-fetch-dest"] === "document" &&
    ["GET", "HEAD"].includes(request.method ?? "")
  )
    return
  throw new Error("Local browser request requires an approved document origin")
}

function websocket(input: IncomingHttpHeaders) {
  return (
    input.upgrade?.toLowerCase() === "websocket" &&
    input.connection?.split(",").some((value) => value.trim().toLowerCase() === "upgrade") === true
  )
}

function key(input: IncomingHttpHeaders) {
  const value = input["sec-websocket-key"]
  if (
    !websocket(input) ||
    input["sec-websocket-version"] !== "13" ||
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/]{22}==$/.test(value) ||
    Buffer.from(value, "base64").length !== 16 ||
    input["content-length"] !== undefined ||
    input["transfer-encoding"] !== undefined
  ) {
    throw new TypeError("Invalid WebSocket upgrade")
  }
  return value
}

function opening(input: Buffer, url: URL) {
  const end = input.indexOf("\r\n\r\n")
  if (end < 0) return false
  if (end + 4 !== input.length) throw new TypeError("Unexpected WebSocket handshake data")
  const lines = input.subarray(0, end).toString("latin1").split("\r\n")
  const line = /^GET (\/[^\s#]*) HTTP\/1\.1$/.exec(lines.shift() ?? "")
  if (!line || parse(`${url.origin}${line[1]}`).origin !== url.origin) {
    throw new TypeError("Invalid WebSocket request")
  }
  const fields: IncomingHttpHeaders = Object.create(null)
  for (const line of lines) {
    const colon = line.indexOf(":")
    const name = line.slice(0, colon).toLowerCase()
    const value = line.slice(colon + 1)
    validateHeaderName(name)
    validateHeaderValue(name, value)
    if (colon < 1 || fields[name] !== undefined) throw new TypeError("Invalid WebSocket headers")
    fields[name] = value.trim()
  }
  const host = fields.host ?? ""
  if (/[\s/?#@\\]/.test(host)) throw new TypeError("Invalid WebSocket host")
  const target = parse(`http://${host}/`)
  if (target.origin !== url.origin || fields.origin !== url.origin || fields["proxy-authorization"] !== undefined) {
    throw new TypeError("WebSocket origin is not approved")
  }
  key(fields)
  return true
}

function validate(input: Buffer) {
  let offset = 0
  const take = (size: number) => {
    if (offset + size > input.length) throw new TypeError("Truncated TLS ClientHello")
    const value = input.subarray(offset, offset + size)
    offset += size
    return value
  }
  const version = take(2)
  if (version[0] !== 3 || version[1] < 1 || version[1] > 3) throw new TypeError("Invalid TLS version")
  take(32)
  const session = take(1)[0]
  if (session > 32) throw new TypeError("Invalid TLS session")
  take(session)
  const ciphers = take(2).readUInt16BE()
  if (ciphers < 2 || ciphers % 2) throw new TypeError("Invalid TLS ciphers")
  take(ciphers)
  const compression = take(take(1)[0])
  if (!compression.includes(0)) throw new TypeError("Invalid TLS compression")
  const length = take(2).readUInt16BE()
  if (length !== input.length - offset) throw new TypeError("Invalid TLS extensions")
  const seen = new Set<number>()
  while (offset < input.length) {
    const type = take(2).readUInt16BE()
    const size = take(2).readUInt16BE()
    if (seen.has(type)) throw new TypeError("Duplicate TLS extension")
    seen.add(type)
    take(size)
  }
}

class Preface {
  private readonly input: Buffer
  private readonly body = Buffer.alloc(64 * 1024 + 4)
  private size = 0
  private offset = 0
  private count = 0
  private ready = false

  constructor(private readonly url: URL) {
    this.input = Buffer.alloc(url.protocol === "http:" ? LIMIT : 128 * 1024)
  }

  push(chunk: Buffer) {
    if (this.size + chunk.length > this.input.length) throw new TypeError("Proxy handshake is too large")
    chunk.copy(this.input, this.size)
    this.size += chunk.length
    if (this.url.protocol === "http:") return opening(this.bytes(), this.url)
    if (this.ready) return true
    while (this.offset + 5 <= this.size) {
      const start = this.offset
      const length = this.input.readUInt16BE(start + 3)
      if (
        this.input[start] !== 22 ||
        this.input[start + 1] !== 3 ||
        this.input[start + 2] < 1 ||
        this.input[start + 2] > 3 ||
        length === 0 ||
        length > LIMIT
      ) {
        throw new TypeError("CONNECT requires TLS")
      }
      if (start + 5 + length > this.size) return false
      if (this.count + length > this.body.length) throw new TypeError("TLS ClientHello is too large")
      this.input.copy(this.body, this.count, start + 5, start + 5 + length)
      this.count += length
      this.offset += length + 5
      if (this.count < 4) continue
      const size = this.body.readUIntBE(1, 3)
      if (this.body[0] !== 1 || size > 65535) throw new TypeError("Invalid TLS ClientHello")
      if (this.count < size + 4) continue
      if (this.count !== size + 4) throw new TypeError("Invalid TLS handshake length")
      validate(this.body.subarray(4, this.count))
      this.ready = true
      return true
    }
    return false
  }

  bytes() {
    return this.input.subarray(0, this.size)
  }
}

function scope(client: Duplex, parent: AbortSignal, timeout: number) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, timeout)
  timer.unref()
  client.once("close", abort)
  client.once("error", abort)
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    abort,
    ready: () => clearTimeout(timer),
    close: () => {
      clearTimeout(timer)
      client.off("close", abort)
      client.off("error", abort)
    },
  }
}

function waiting<T>(promise: Promise<T>, signal: AbortSignal) {
  const pending = Promise.withResolvers<T>()
  const abort = () => pending.reject(new Error("Proxy request cancelled"))
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  return Promise.race([promise, pending.promise]).finally(() => signal.removeEventListener("abort", abort))
}

function pipe(client: Duplex, upstream: Socket, head: Buffer) {
  client.pause()
  client.once("close", () => upstream.destroy())
  upstream.once("close", () => client.destroy())
  upstream.pipe(client)
  const resume = () => client.pipe(upstream)
  if (head.length === 0 || upstream.write(head)) resume()
  else upstream.once("drain", resume)
}

export class BrowserProxy {
  readonly proxy: Readonly<{ server: string; bypass: "<-loopback>" }>
  readonly credentials: Readonly<{ username: string; password: string; origin: string; realm: string }>
  private readonly sockets = new Set<Socket>()
  private readonly stop = new AbortController()
  private closing: Promise<void> | undefined

  private constructor(
    private readonly policy: string,
    private readonly opts: Options,
    private readonly server: Server,
    origin: string,
    private readonly timeout: number,
  ) {
    this.proxy = Object.freeze({ server: origin, bypass: "<-loopback>" })
    this.credentials = Object.freeze({
      username: randomBytes(16).toString("hex"),
      password: randomBytes(32).toString("base64url"),
      origin,
      realm: `kilo-browser-${randomBytes(16).toString("hex")}`,
    })
    server.on("connection", (socket) => this.track(socket))
    server.on("request", (request, response) => void this.forward(request, response))
    server.on("upgrade", (request, client, head) => void this.upgrade(request, client, head))
    server.on("connect", (request, client, head) => this.tunnel(request, client, head))
    server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n", () => socket.destroy())
    })
  }

  static async start(policy: "deny" | "public" | URL, opts: Options = {}) {
    const target = policy instanceof URL ? parse(policy.href) : policy
    if (target instanceof URL ? target.protocol !== "http:" : !["deny", "public"].includes(target)) {
      throw new TypeError("Invalid browser proxy policy")
    }
    const timeout = opts.timeout ?? 30_000
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) {
      throw new TypeError("Invalid browser proxy timeout")
    }
    const server = createServer({
      maxHeaderSize: LIMIT,
      headersTimeout: Math.min(timeout, 10_000),
      requestTimeout: timeout,
      connectionsCheckingInterval: Math.min(timeout, 1_000),
      keepAliveTimeout: 5_000,
    })
    server.maxConnections = 128
    const ready = once(server, "listening")
    server.listen(0, "127.0.0.1")
    await ready
    const address = server.address()
    if (!address || typeof address === "string") {
      server.close()
      throw new Error("Browser proxy did not bind a local port")
    }
    return new BrowserProxy(
      target instanceof URL ? target.origin : target,
      opts,
      server,
      `http://127.0.0.1:${address.port}`,
      timeout,
    )
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const closed = Promise.withResolvers<void>()
    this.closing = closed.promise
    this.stop.abort()
    for (const socket of this.sockets) socket.destroy()
    this.server.close(() => closed.resolve())
    return this.closing
  }

  private track(socket: Socket) {
    this.sockets.add(socket)
    socket.once("close", () => this.sockets.delete(socket))
    socket.on("error", () => socket.destroy())
    if (this.stop.signal.aborted) socket.destroy()
    return socket
  }

  private authenticated(request: IncomingMessage) {
    const value = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(request.headers["proxy-authorization"] ?? "")
    if (!value) return false
    const actual = Buffer.from(value[1], "base64")
    const expected = Buffer.from(`${this.credentials.username}:${this.credentials.password}`)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  private challenge() {
    return { "Proxy-Authenticate": `Basic realm="${this.credentials.realm}"` }
  }

  private reject(client: Duplex, status = 403) {
    const challenge = status === 407 ? `Proxy-Authenticate: ${this.challenge()["Proxy-Authenticate"]}\r\n` : ""
    client.end(
      `HTTP/1.1 ${status} Proxy Request Rejected\r\n${challenge}Connection: close\r\nContent-Length: 0\r\n\r\n`,
      () => client.destroy(),
    )
  }

  private target(value: string, tunnel = false) {
    if (this.policy === "deny" || (this.policy === "public" && !tunnel)) {
      throw new Error("Browser proxy destination is not approved")
    }
    const local = tunnel && this.policy !== "public" && new URL(`http://${value}/`).origin === this.policy
    const url = tunnel ? authority(value, local ? "http" : "https") : parse(value.replace(/^ws:/i, "http:"))
    if (!tunnel && (url.protocol !== "http:" || url.origin !== this.policy)) {
      throw new Error("Browser proxy origin is not approved")
    }
    if (url.hash) throw new TypeError("Invalid proxy request URL")
    return url
  }

  private async dial(url: URL, signal: AbortSignal) {
    signal.throwIfAborted()
    const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
    const family = isIP(host)
    const answers = family
      ? [{ address: host, family }]
      : await waiting(
          (this.opts.lookup ?? ((host) => lookup(host, { all: true, verbatim: true })))(host, signal),
          signal,
        )
    signal.throwIfAborted()
    const addresses = answers.map((entry) => ({ address: entry.address, family: entry.family }))
    if (
      addresses.length === 0 ||
      addresses.some(
        (entry) =>
          !isIP(entry.address) ||
          isIP(entry.address) !== entry.family ||
          (url.protocol === "https:" ? !isPublicAddress(entry.address) : !["127.0.0.1", "::1"].includes(entry.address)),
      )
    ) {
      throw new Error("Browser proxy denied a non-public or unapproved address")
    }
    const timeout = addresses.length > 1 ? Math.min(5_000, this.timeout / addresses.length) : this.timeout
    let err: unknown = new Error("Browser proxy could not connect")
    for (const address of addresses) {
      signal.throwIfAborted()
      const family = isIP(address.address)
      if (family !== 4 && family !== 6) throw new Error("Invalid proxy address family")
      const socket = this.track(
        (this.opts.connect ?? connect)({
          host: address.address,
          port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
          family,
        }),
      )
      const attempt = scope(socket, signal, timeout)
      try {
        await once(socket, "connect", { signal: attempt.signal })
        attempt.signal.throwIfAborted()
        return { socket, host: address.address, family }
      } catch (cause) {
        socket.destroy()
        err = cause
      } finally {
        attempt.close()
      }
    }
    throw err
  }

  private tunnel(request: IncomingMessage, client: Duplex, head: Buffer) {
    if (!this.authenticated(request)) return this.reject(client, 407)
    const url = (() => {
      try {
        return this.target(request.url ?? "", true)
      } catch {
        this.reject(client)
      }
    })()
    if (!url) return
    const state = scope(client, this.stop.signal, this.timeout)
    const preface = new Preface(url)
    let pending = false
    const cleanup = () => {
      client.off("data", inspect)
      client.off("end", fail)
      state.signal.removeEventListener("abort", fail)
      state.close()
    }
    const fail = () => {
      cleanup()
      state.abort()
      client.destroy()
    }
    const inspect = (chunk: Buffer) => {
      try {
        if (!preface.push(chunk) || pending) return
        pending = true
        void this.dial(url, state.signal).then((peer) => {
          if (state.signal.aborted || client.destroyed) {
            peer.socket.destroy()
            fail()
            return
          }
          cleanup()
          pipe(client, peer.socket, preface.bytes())
        }, fail)
      } catch {
        fail()
      }
    }
    state.signal.addEventListener("abort", fail, { once: true })
    client.once("end", fail)
    client.on("data", inspect)
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head.length) inspect(head)
    client.resume()
  }

  private async forward(request: IncomingMessage, response: ServerResponse) {
    if (!this.authenticated(request)) {
      response.writeHead(407, { ...this.challenge(), connection: "close" }).end()
      return
    }
    const state = scope(request.socket, this.stop.signal, this.timeout)
    response.once("close", () => {
      state.abort()
      state.close()
    })
    response.once("finish", state.close)
    try {
      const url = this.target(request.url ?? "")
      local(request, url)
      const peer = await this.dial(url, state.signal)
      const upstream = send({
        hostname: peer.host,
        family: peer.family,
        port: Number(url.port || 80),
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: headers(request.headers, url.host),
        createConnection: () => peer.socket,
        signal: state.signal,
      })
      upstream.on("response", (incoming) => {
        state.ready()
        response.writeHead(incoming.statusCode ?? 502, headers(incoming.headers))
        incoming.on("error", () => response.destroy())
        incoming.pipe(response)
      })
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      request.pipe(upstream)
    } catch {
      state.close()
      if (!response.headersSent) response.writeHead(403, { connection: "close" })
      response.end()
    }
  }

  private async upgrade(request: IncomingMessage, client: Duplex, head: Buffer) {
    if (!this.authenticated(request)) return this.reject(client, 407)
    const state = scope(client, this.stop.signal, this.timeout)
    try {
      const url = this.target(request.url ?? "")
      if (request.headers.origin !== url.origin) throw new Error("Local WebSocket origin is not approved")
      if (request.method !== "GET") throw new TypeError("Invalid WebSocket method")
      const accept = createHash("sha1")
        .update(`${key(request.headers)}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64")
      const peer = await this.dial(url, state.signal)
      const upstream = send({
        hostname: peer.host,
        family: peer.family,
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        headers: { ...headers(request.headers, url.host), connection: "Upgrade", upgrade: "websocket" },
        createConnection: () => peer.socket,
        signal: state.signal,
      })
      upstream.on("response", (incoming) => {
        incoming.destroy()
        state.close()
        this.reject(client, 502)
      })
      upstream.on("error", () => {
        state.close()
        client.destroy()
      })
      upstream.on("upgrade", (incoming, socket, data) => {
        state.close()
        if (!websocket(incoming.headers) || incoming.headers["sec-websocket-accept"] !== accept) {
          socket.destroy()
          this.reject(client, 502)
          return
        }
        const fields = { ...headers(incoming.headers), connection: "Upgrade", upgrade: "websocket" }
        client.write("HTTP/1.1 101 Switching Protocols\r\n")
        for (const [name, value] of Object.entries(fields)) {
          for (const item of Array.isArray(value) ? value : [value]) client.write(`${name}: ${item}\r\n`)
        }
        client.write("\r\n")
        if (data.length) client.write(data)
        pipe(client, peer.socket, head)
      })
      upstream.end()
    } catch {
      state.close()
      this.reject(client)
    }
  }
}
