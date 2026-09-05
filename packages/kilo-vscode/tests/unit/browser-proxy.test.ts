import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import {
  createServer as http,
  request,
  type IncomingHttpHeaders,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http"
import { connect, createServer, type Server, Socket } from "node:net"
import WebSocket, { WebSocketServer } from "ws"
import { BrowserProxy } from "../../src/services/browser-automation/browser-proxy"

const cleanup: Array<() => Promise<unknown> | void> = []

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function listen(server: Server | HttpServer) {
  const sockets = new Set<Socket>()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => sockets.delete(socket))
  })
  const ready = once(server, "listening")
  server.listen(0, "127.0.0.1")
  await ready
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server port")
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return address.port
}

async function proxy(...args: Parameters<typeof BrowserProxy.start>) {
  const value = await BrowserProxy.start(...args)
  cleanup.push(() => value.close())
  return value
}

function auth(proxy: BrowserProxy) {
  return `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`
}

async function client(proxy: BrowserProxy) {
  const socket = connect(Number(new URL(proxy.proxy.server).port), "127.0.0.1")
  socket.on("error", () => socket.destroy())
  socket.setTimeout(2_000, () => socket.destroy(new Error("Test socket timed out")))
  cleanup.push(() => socket.destroy())
  await once(socket, "connect")
  return socket
}

function receive(socket: Socket, complete: (input: Buffer) => boolean) {
  const result = Promise.withResolvers<Buffer>()
  const chunks: Buffer[] = []
  const clean = () => {
    socket.off("data", data)
    socket.off("close", close)
    socket.off("error", error)
  }
  const error = (error: Error) => {
    clean()
    result.reject(error)
  }
  const close = () => error(new Error(`Socket closed: ${Buffer.concat(chunks).toString()}`))
  const data = (chunk: Buffer) => {
    chunks.push(chunk)
    const input = Buffer.concat(chunks)
    if (!complete(input)) return
    socket.pause()
    clean()
    result.resolve(input)
  }
  socket.on("data", data)
  socket.once("close", close)
  socket.once("error", error)
  socket.resume()
  return result.promise
}

function closed(socket: Socket) {
  return new Promise<void>((resolve) => {
    if (socket.closed) return resolve()
    socket.once("close", () => resolve())
    socket.resume()
  })
}

function command(proxy: BrowserProxy, target: string) {
  return `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`
}

async function tunnel(proxy: BrowserProxy, target = "public.example:443") {
  const socket = await client(proxy)
  const response = receive(socket, (input) => input.includes("\r\n\r\n"))
  socket.write(command(proxy, target))
  expect((await response).toString()).toStartWith("HTTP/1.1 200")
  return socket
}

function word(value: number) {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value)
  return bytes
}

function record(input: Buffer) {
  return Buffer.concat([Buffer.from([22, 3, 1]), word(input.length), input])
}

function hello(encrypted = false, named = true) {
  const name = Buffer.from("public.example")
  const names = Buffer.concat([Buffer.from([0]), word(name.length), name])
  const sni = named ? Buffer.concat([word(0), word(names.length + 2), word(names.length), names]) : Buffer.alloc(0)
  const extensions = Buffer.concat([sni, ...(encrypted ? [Buffer.from([0xfe, 0x0d, 0, 1, 0])] : [])])
  const body = Buffer.concat([
    Buffer.from([3, 3]),
    Buffer.alloc(32),
    Buffer.from([0, 0, 2, 0x13, 1, 1, 0]),
    word(extensions.length),
    extensions,
  ])
  const header = Buffer.alloc(4)
  header[0] = 1
  header.writeUIntBE(body.length, 1, 3)
  return record(Buffer.concat([header, body]))
}

async function target() {
  let accepted = 0
  const bytes: Buffer[] = []
  const server = createServer((socket) => {
    accepted++
    socket.on("data", (chunk) => {
      bytes.push(chunk)
      socket.write(chunk)
    })
  })
  return { port: await listen(server), accepted: () => accepted, bytes: () => Buffer.concat(bytes) }
}

function forward(proxy: BrowserProxy, url: string, headers: IncomingHttpHeaders = {}, body = "") {
  const result = Promise.withResolvers<{ status: number; headers: IncomingHttpHeaders; body: string }>()
  const fields = { "sec-fetch-site": "same-origin", ...headers, "proxy-authorization": auth(proxy) }
  const req = request(proxy.proxy.server, { method: body ? "POST" : "GET", path: url, headers: fields }, (res) => {
    const chunks: Buffer[] = []
    res.on("data", (chunk) => chunks.push(chunk))
    res.once("end", () =>
      result.resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
    )
    res.once("error", result.reject)
  })
  req.once("error", result.reject)
  req.end(body)
  return result.promise
}

describe("browser proxy", () => {
  test("isolates proxy capabilities and authenticates every protocol before DNS", async () => {
    const calls: string[] = []
    const first = await proxy("public", {
      lookup: async (host) => {
        calls.push(host)
        return []
      },
    })
    const second = await proxy("public")
    expect(first.credentials.realm).not.toBe(second.credentials.realm)
    expect(first.credentials.password).not.toBe(second.credentials.password)
    expect(first.credentials.origin).toBe(first.proxy.server)
    expect(first.proxy.bypass).toBe("<-loopback>")
    expect(Object.keys(first.proxy)).toEqual(["server", "bypass"])
    for (const line of [
      "GET http://public.example/ HTTP/1.1",
      "CONNECT public.example:443 HTTP/1.1",
      "GET http://public.example/socket HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket",
    ]) {
      for (const value of [
        "",
        auth(second),
        `Basic ${Buffer.from(`wrong:${first.credentials.password}`).toString("base64")}`,
      ]) {
        const socket = await client(first)
        const response = receive(socket, (input) => input.includes("\r\n\r\n"))
        socket.write(`${line}\r\nHost: public.example\r\nProxy-Authorization: ${value}\r\n\r\n`)
        const text = (await response).toString()
        expect(text).toStartWith("HTTP/1.1 407 ")
        expect(text).toContain(`Proxy-Authenticate: Basic realm="${first.credentials.realm}"`)
      }
    }
    expect(calls).toEqual([])
  })

  test("denies public plaintext and deny-policy requests without resolution", async () => {
    const calls: string[] = []
    for (const policy of ["deny", "public"] as const) {
      const value = await proxy(policy, {
        lookup: async (host) => {
          calls.push(host)
          return []
        },
      })
      expect((await forward(value, "http://public.example/")).status).toBe(403)
      const socket = await client(value)
      const response = receive(socket, (input) => input.includes("\r\n\r\n"))
      socket.write(command(value, policy === "deny" ? "public.example:443" : "127.0.0.1:443"))
      expect((await response).toString()).toStartWith("HTTP/1.1 403")
    }
    expect(calls).toEqual([])
  })

  test("pins public numeric addresses and preserves fragmented TLS including ECH GREASE", async () => {
    const server = await target()
    const calls: Array<{ host: string; port: number; family: number }> = []
    const names: string[] = []
    const value = await proxy("public", {
      lookup: async (host) => {
        names.push(host)
        return [{ address: "8.8.8.8", family: 4 }]
      },
      connect: (options) => {
        calls.push(options)
        return connect(server.port, "127.0.0.1")
      },
    })
    for (const host of ["public.example:8443", "third-party.example:443"]) {
      const socket = await tunnel(value, host)
      const input = hello(true).subarray(5)
      const fragments = Buffer.concat([
        record(input.subarray(0, 2)),
        record(input.subarray(2, 17)),
        record(input.subarray(17)),
      ])
      const response = receive(socket, (input) => input.length >= fragments.length)
      socket.write(fragments.subarray(0, 4))
      socket.write(fragments.subarray(4))
      expect(await response).toEqual(fragments)
    }
    expect(names).toEqual(["public.example", "third-party.example"])
    expect(calls).toEqual([
      { host: "8.8.8.8", port: 8443, family: 4 },
      { host: "8.8.8.8", port: 443, family: 4 },
    ])
    expect(server.accepted()).toBe(2)
  })

  test.each([
    ["8.8.8.8:443", "8.8.8.8", 4],
    ["[2606:4700:4700::1111]:443", "2606:4700:4700::1111", 6],
  ] as const)("pins literal %s and preserves coalesced CONNECT data without SNI", async (host, address, family) => {
    const server = await target()
    const calls: Array<{ host: string; port: number; family: number }> = []
    const value = await proxy("public", {
      lookup: async () => {
        throw new Error("IP literals must not use DNS")
      },
      connect: (options) => {
        calls.push(options)
        return connect(server.port, "127.0.0.1")
      },
    })
    const socket = await client(value)
    const input = hello(false, false)
    const response = receive(socket, (data) => {
      const end = data.indexOf("\r\n\r\n")
      return end >= 0 && data.length >= end + 4 + input.length
    })
    socket.write(Buffer.concat([Buffer.from(command(value, host)), input]))
    const data = await response
    expect(data.subarray(data.indexOf("\r\n\r\n") + 4)).toEqual(input)
    expect(calls).toEqual([{ host: address, port: 443, family }])
  })

  test("validates every DNS candidate and address family before any socket is opened", async () => {
    const server = await target()
    let answers: { address: string; family: number }[] = []
    let dials = 0
    const value = await proxy("public", {
      lookup: async () => answers,
      connect: () => {
        dials++
        return connect(server.port, "127.0.0.1")
      },
    })
    for (const entries of [
      [],
      [{ address: "127.0.0.1", family: 4 }],
      [{ address: "10.0.0.1", family: 4 }],
      [{ address: "169.254.169.254", family: 4 }],
      [{ address: "::1", family: 6 }],
      [{ address: "fe80::1", family: 6 }],
      [{ address: "::ffff:8.8.8.8", family: 6 }],
      [{ address: "8.8.8.8", family: 6 }],
      [{ address: "not-an-address", family: 4 }],
      [
        { address: "8.8.8.8", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ],
    ]) {
      answers = entries
      const socket = await tunnel(value)
      const end = closed(socket)
      socket.write(hello())
      await end
    }
    expect(dials).toBe(0)
    expect(server.accepted()).toBe(0)
    expect(server.bytes()).toHaveLength(0)
  })

  test("tries the next validated numeric address when an earlier dial stalls", async () => {
    const server = await target()
    const stalled = new Socket()
    const calls: Array<{ host: string; port: number; family: number }> = []
    const value = await proxy("public", {
      timeout: 100,
      lookup: async () => [
        { address: "2606:4700:4700::1111", family: 6 },
        { address: "8.8.8.8", family: 4 },
      ],
      connect: (options) => {
        calls.push(options)
        return calls.length === 1 ? stalled : connect(server.port, "127.0.0.1")
      },
    })
    const socket = await tunnel(value)
    const input = hello()
    const response = receive(socket, (data) => data.length >= input.length)
    socket.write(input)
    expect(await response).toEqual(input)
    expect(calls).toEqual([
      { host: "2606:4700:4700::1111", port: 443, family: 6 },
      { host: "8.8.8.8", port: 443, family: 4 },
    ])
    expect(stalled.destroyed).toBe(true)
    expect(server.accepted()).toBe(1)
  })

  test.each(["disposal", "disconnect"])("%s cancels a stalled dial without trying later candidates", async (mode) => {
    const started = Promise.withResolvers<Socket>()
    const calls: string[] = []
    const value = await proxy("public", {
      timeout: 100,
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "1.1.1.1", family: 4 },
      ],
      connect: (options) => {
        calls.push(options.host)
        const socket = new Socket()
        started.resolve(socket)
        return socket
      },
    })
    const socket = await tunnel(value)
    socket.write(hello())
    const upstream = await started.promise
    const end = Promise.all([closed(socket), closed(upstream)])
    if (mode === "disposal") await value.close()
    if (mode === "disconnect") socket.destroy()
    await end
    expect(upstream.destroyed).toBe(true)
    expect(calls).toEqual(["8.8.8.8"])
  })

  test("rechecks DNS on the next tunnel instead of reusing an earlier public answer", async () => {
    const server = await target()
    let count = 0
    let dials = 0
    const value = await proxy("public", {
      lookup: async () => [{ address: ++count === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }],
      connect: () => {
        dials++
        return connect(server.port, "127.0.0.1")
      },
    })
    const first = await tunnel(value)
    const input = hello()
    const response = receive(first, (input) => input.length >= hello().length)
    first.write(input)
    expect(await response).toEqual(input)
    const second = await tunnel(value)
    const end = closed(second)
    second.write(input)
    await end
    expect(count).toBe(2)
    expect(dials).toBe(1)
    expect(server.accepted()).toBe(1)
  })

  test("rejects plaintext, malformed and oversized TLS before DNS or upstream contact", async () => {
    const server = await target()
    let lookups = 0
    let dials = 0
    const value = await proxy("public", {
      lookup: async () => {
        lookups++
        return [{ address: "8.8.8.8", family: 4 }]
      },
      connect: () => {
        dials++
        return connect(server.port, "127.0.0.1")
      },
    })
    for (const input of [
      Buffer.from("GET / HTTP/1.1\r\n\r\n"),
      Buffer.from([22, 3, 1, 0xff, 0xff]),
      record(Buffer.from([2, 0, 0, 1, 0])),
      record(Buffer.from([1, 1, 0, 0])),
      record(Buffer.from([1, 0, 0, 1, 0])),
    ]) {
      const socket = await tunnel(value)
      const end = closed(socket)
      socket.write(input)
      await end
    }
    expect(lookups).toBe(0)
    expect(dials).toBe(0)
    expect(server.accepted()).toBe(0)
  })

  test.each(["disposal", "disconnect"])("%s prevents delayed DNS from opening a socket", async (mode) => {
    const server = await target()
    const started = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    const answers = Promise.withResolvers<{ address: string; family: number }[]>()
    let dials = 0
    const value = await proxy("public", {
      lookup: (_host, signal) => {
        signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
        started.resolve()
        return answers.promise
      },
      connect: () => {
        dials++
        return connect(server.port, "127.0.0.1")
      },
    })
    const socket = await tunnel(value)
    const end = closed(socket)
    socket.write(hello())
    await started.promise
    if (mode === "disposal") await value.close()
    if (mode === "disconnect") socket.destroy()
    await cancelled.promise
    answers.resolve([{ address: "8.8.8.8", family: 4 }])
    await end
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(dials).toBe(0)
    expect(server.accepted()).toBe(0)
    await value.close()
  })

  test("closes established sockets without affecting another context proxy", async () => {
    const server = await target()
    const opts = {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      connect: () => connect(server.port, "127.0.0.1"),
    }
    const first = await proxy("public", opts)
    const second = await proxy("public", opts)
    const input = hello()
    const socket = await tunnel(first)
    const response = receive(socket, (data) => data.length >= input.length)
    socket.write(input)
    expect(await response).toEqual(input)
    const end = closed(socket)
    await first.close()
    await end
    const other = await tunnel(second)
    const output = receive(other, (data) => data.length >= input.length)
    other.write(input)
    expect(await output).toEqual(input)
  })

  test("bounds HTTP headers before any DNS lookup", async () => {
    let lookups = 0
    const value = await proxy("public", {
      lookup: async () => {
        lookups++
        return []
      },
    })
    const socket = await client(value)
    const response = receive(socket, (input) => input.includes("\r\n\r\n"))
    socket.write(
      `CONNECT public.example:443 HTTP/1.1\r\nHost: public.example\r\nProxy-Authorization: ${auth(value)}\r\nX-Large: ${"a".repeat(20 * 1024)}\r\n\r\n`,
    )
    expect((await response).toString()).toMatch(/^HTTP\/1\.1 4\d\d/)
    expect(lookups).toBe(0)
  })

  test("bounds stalled handshakes and DNS resolution", async () => {
    let dials = 0
    const value = await proxy("public", {
      timeout: 30,
      lookup: () => new Promise(() => undefined),
      connect: () => {
        dials++
        throw new Error("Unexpected connection")
      },
    })
    for (const input of [Buffer.from([22, 3]), hello()]) {
      const socket = await tunnel(value)
      const end = closed(socket)
      socket.write(input)
      await end
    }
    expect(dials).toBe(0)
  })

  test("local profiles allow pinned public TLS but reject private answers and plaintext public requests", async () => {
    const server = await target()
    let answers = [{ address: "8.8.8.8", family: 4 }]
    const calls: Array<{ host: string; port: number; family: number }> = []
    const value = await proxy(new URL("http://localhost:3000"), {
      lookup: async () => answers,
      connect: (options) => {
        calls.push(options)
        return connect(server.port, "127.0.0.1")
      },
    })
    const socket = await tunnel(value)
    const input = hello()
    const echoed = receive(socket, (data) => data.length >= input.length)
    socket.write(input)
    expect(await echoed).toEqual(input)
    expect(calls).toEqual([{ host: "8.8.8.8", port: 443, family: 4 }])
    answers = [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]
    const denied = await tunnel(value, "rebound.example:443")
    const done = closed(denied)
    denied.write(input)
    await done
    expect((await forward(value, "http://public.example/")).status).toBe(403)
    expect((await forward(value, "http://localhost:3001/")).status).toBe(403)
    expect(calls).toHaveLength(1)
    expect(server.accepted()).toBe(1)
  })

  test("rejects cross-site and opaque local HTTP requests before DNS or TCP", async () => {
    const server = http((_request, response) => response.end("local"))
    const port = await listen(server)
    const url = new URL(`http://localhost:${port}/`)
    let lookups = 0
    const value = await proxy(url, {
      lookup: async () => {
        lookups++
        return [{ address: "127.0.0.1", family: 4 }]
      },
    })
    for (const headers of [
      { "sec-fetch-site": "" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "null" },
      { origin: "https://public.example" },
      { "sec-fetch-site": "none", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
      { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
    ]) {
      expect((await forward(value, url.href, headers)).status).toBe(403)
    }
    const navigation = { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }
    expect((await forward(value, url.href, navigation, "unapproved POST")).status).toBe(403)
    expect(lookups).toBe(0)
    expect((await forward(value, url.href, navigation)).status).toBe(200)
    expect((await forward(value, url.href, { origin: url.origin })).status).toBe(200)
    expect(lookups).toBe(2)
  })

  test("forwards local HTTP with origin headers intact and proxy credentials removed", async () => {
    const seen: Array<{ url?: string; host?: string; auth?: string; secret?: string; body: string }> = []
    const server = http((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => {
        seen.push({
          url: req.url,
          host: req.headers.host,
          auth: req.headers.authorization,
          secret: req.headers["proxy-authorization"],
          body: Buffer.concat(chunks).toString(),
        })
        res
          .writeHead(302, {
            location: "http://127.0.0.1:1/private",
            "content-security-policy": "default-src 'self'",
            "x-frame-options": "DENY",
          })
          .end("local response")
      })
    })
    const port = await listen(server)
    const origin = new URL(`http://localhost:${port}`)
    const value = await proxy(origin)
    origin.port = "1"
    const response = await forward(
      value,
      `http://localhost:${port}/path?q=1`,
      { authorization: "Bearer application", host: "wrong.example" },
      "body",
    )
    expect(response).toMatchObject({
      status: 302,
      body: "local response",
      headers: { "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" },
    })
    expect(seen).toEqual([
      { url: "/path?q=1", host: `localhost:${port}`, auth: "Bearer application", secret: undefined, body: "body" },
    ])
    expect((await forward(value, `http://127.0.0.1:${port}/other-origin`)).status).toBe(403)
    expect(seen).toHaveLength(1)
  })

  test.each(["end", "disconnect", "disposal", "error"])(
    "%s closes a local HTTP stream after it outlives the setup deadline",
    async (mode) => {
      const timeout = 50
      const pending = Promise.withResolvers<ServerResponse>()
      const server = http((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" })
        res.flushHeaders()
        const timer = setTimeout(() => res.write("data: alive\n\n"), timeout * 3)
        res.once("close", () => clearTimeout(timer))
        pending.resolve(res)
      })
      const port = await listen(server)
      const url = `http://127.0.0.1:${port}/events`
      const value = await proxy(new URL(url), { timeout })
      const socket = await client(value)
      const response = receive(socket, (input) => input.includes("data: alive\n\n"))
      socket.write(
        `GET ${url} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nProxy-Authorization: ${auth(value)}\r\nSec-Fetch-Site: same-origin\r\nConnection: close\r\n\r\n`,
      )
      const upstream = await pending.promise
      const end = once(upstream, "close")
      expect((await response).toString()).toStartWith("HTTP/1.1 200")
      expect(upstream.destroyed).toBe(false)
      const done = closed(socket)
      if (mode === "end") upstream.end()
      if (mode === "disconnect") socket.destroy()
      if (mode === "disposal") await value.close()
      if (mode === "error") upstream.destroy()
      await Promise.all([end, done])
      expect(upstream.destroyed).toBe(true)
    },
  )

  test("still bounds local HTTP setup when upstream headers never arrive", async () => {
    const pending = Promise.withResolvers<Socket>()
    const port = await listen(createServer((socket) => pending.resolve(socket)))
    const url = `http://127.0.0.1:${port}/`
    const value = await proxy(new URL(url), { timeout: 50 })
    const response = forward(value, url)
    const upstream = await pending.promise
    const end = closed(upstream)
    expect((await response).status).toBe(502)
    await end
    expect(upstream.destroyed).toBe(true)
  })

  test("does not contact a non-loopback answer for an approved localhost origin", async () => {
    let dials = 0
    const value = await proxy(new URL("http://localhost:3000"), {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      connect: () => {
        dials++
        throw new Error("Unexpected connection")
      },
    })
    expect((await forward(value, "http://localhost:3000/")).status).toBe(403)
    expect(dials).toBe(0)
  })

  test("proxies exact-origin WebSocket upgrades and preserves bidirectional frames", async () => {
    const server = http()
    const sockets = new WebSocketServer({ server })
    const seen: IncomingHttpHeaders[] = []
    sockets.on("connection", (socket, request) => {
      seen.push(request.headers)
      socket.on("message", (data) => socket.send(data.toString()))
    })
    const port = await listen(server)
    cleanup.push(() => {
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
    })
    const value = await proxy(new URL(`http://localhost:${port}`))
    const pending = Promise.withResolvers<Socket>()
    const req = request(value.proxy.server, {
      path: `http://localhost:${port}/socket`,
      headers: {
        host: `localhost:${port}`,
        origin: `http://localhost:${port}`,
        "proxy-authorization": auth(value),
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })
    req.on("upgrade", (_response, socket) => pending.resolve(socket))
    req.on("response", (response) => pending.reject(new Error(`Upgrade failed: ${response.statusCode}`)))
    req.on("error", pending.reject)
    req.end()
    const socket = await pending.promise
    cleanup.push(() => socket.destroy())
    const response = receive(socket, (input) => input.length >= 4)
    socket.write(Buffer.from([0x81, 0x82, 1, 2, 3, 4, 0x68 ^ 1, 0x69 ^ 2]))
    expect(await response).toEqual(Buffer.from([0x81, 2, 0x68, 0x69]))
    expect(seen.at(0)?.["proxy-authorization"]).toBeUndefined()
  })

  test("rejects unapproved or malformed local CONNECT handshakes without contact", async () => {
    const server = await target()
    let dials = 0
    const value = await proxy(new URL(`http://localhost:${server.port}`), {
      connect: () => {
        dials++
        return connect(server.port, "127.0.0.1")
      },
    })
    const fields =
      "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    const suffix = `Origin: http://localhost:${server.port}\r\n${fields}`
    for (const input of [
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\n\r\n`,
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\n${fields}`,
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\nOrigin: null\r\n${fields}`,
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\nOrigin: https://public.example\r\n${fields}`,
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\n${suffix}`,
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\nProxy-Authorization: secret\r\n${suffix}`,
      `GET / HTTP/1.1\r\nHost: localhost:${server.port}\r\n${suffix}GET /second HTTP/1.1\r\n\r\n`,
    ]) {
      const socket = await tunnel(value, `localhost:${server.port}`)
      const end = closed(socket)
      socket.write(input)
      await end
    }
    expect(dials).toBe(0)
    expect(server.accepted()).toBe(0)
  })

  test("supports exact-origin local WebSockets inside CONNECT", async () => {
    const server = http()
    const sockets = new WebSocketServer({ server })
    sockets.on("connection", (socket) => socket.on("message", (data) => socket.send(data.toString())))
    const port = await listen(server)
    cleanup.push(() => {
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
    })
    const value = await proxy(new URL(`http://localhost:${port}`))
    const socket = await tunnel(value, `localhost:${port}`)
    const websocket = new WebSocket(`ws://localhost:${port}/socket`, {
      origin: `http://localhost:${port}`,
      createConnection: () => socket,
    })
    cleanup.push(() => websocket.terminate())
    await once(websocket, "open")
    const response = once(websocket, "message")
    websocket.send("local websocket")
    expect((await response).at(0).toString()).toBe("local websocket")
  })
})
