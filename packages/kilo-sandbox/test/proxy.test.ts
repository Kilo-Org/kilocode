import { afterEach, describe, expect, test } from "bun:test"
import { lstat } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { startProxy, type ProxyResolver, type ProxyRuntime } from "../src/proxy"
import { TlsClientHello } from "../src/tls-client-hello"

const close: Array<() => Promise<void> | void> = []
const posix = process.platform === "win32" ? test.skip : test

afterEach(async () => {
  await Promise.all(close.splice(0).map((dispose) => dispose()))
})

function upstream() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return new Response(new URL(request.url).pathname)
    },
  })
  close.push(() => server.stop(true))
  return server
}

function resolver(port: number, calls: string[]): ProxyResolver {
  return async (dest) => {
    calls.push(dest.authority)
    if (dest.port !== port) throw new Error("unexpected port")
    return { address: "127.0.0.1", family: 4 as const }
  }
}

function uint16(value: number) {
  const result = Buffer.alloc(2)
  result.writeUInt16BE(value)
  return result
}

function extension(type: number, data: Buffer) {
  return Buffer.concat([uint16(type), uint16(data.length), data])
}

function record(type: number, data: Buffer, minor = 1) {
  return Buffer.concat([Buffer.from([type, 3, minor]), uint16(data.length), data])
}

function hello(host?: string, extra: Buffer[] = []) {
  const name = host ? Buffer.from(host, "ascii") : undefined
  const sni = name
    ? extension(0, Buffer.concat([uint16(name.length + 3), Buffer.from([0]), uint16(name.length), name]))
    : Buffer.alloc(0)
  const extensions = Buffer.concat([sni, ...extra])
  const body = Buffer.concat([
    Buffer.from([3, 3]),
    Buffer.alloc(32),
    Buffer.from([0]),
    uint16(2),
    Buffer.from([0x13, 0x01]),
    Buffer.from([1, 0]),
    uint16(extensions.length),
    extensions,
  ])
  const handshake = Buffer.alloc(4)
  handshake[0] = 1
  handshake.writeUIntBE(body.length, 1, 3)
  const payload = Buffer.concat([handshake, body])
  return record(22, payload)
}

function fragmented(input: Buffer) {
  const payload = input.subarray(5)
  return Buffer.concat([
    record(22, payload.subarray(0, 2)),
    record(22, payload.subarray(2, 19)),
    record(22, payload.subarray(19)),
  ])
}

function target() {
  let accepted = 0
  const chunks: Buffer[] = []
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        accepted++
      },
      data(socket, data) {
        chunks.push(Buffer.from(data))
        socket.write(data)
      },
    },
  })
  close.push(() => server.stop(true))
  return {
    port: server.port,
    accepted: () => accepted,
    bytes: () => Buffer.concat(chunks),
  }
}

async function tunnel(proxy: ProxyRuntime, authority: string) {
  const socket = connect(proxy.port!, "127.0.0.1")
  close.push(() => {
    socket.destroy()
  })
  const auth = Buffer.from(`kilo:${proxy.token}`).toString("base64")
  await new Promise<void>((resolve, reject) => {
    let response = Buffer.alloc(0)
    const error = (cause: Error) => reject(cause)
    socket.once("error", error)
    socket.once("connect", () =>
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`),
    )
    const data = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk])
      if (!response.includes("\r\n\r\n")) return
      socket.off("data", data)
      socket.off("error", error)
      if (!response.includes("200 Connection Established")) {
        reject(new Error(`CONNECT failed: ${response.toString()}`))
        return
      }
      resolve()
    }
    socket.on("data", data)
  })
  socket.on("error", () => undefined)
  return socket
}

function closed(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("proxy did not close rejected CONNECT")), 1_000)
    socket.once("close", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function receive(socket: Socket, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const cleanup = () => {
      socket.off("data", data)
      socket.off("error", error)
      socket.off("close", closed)
    }
    const error = (cause: Error) => {
      cleanup()
      reject(cause)
    }
    const closed = () => {
      cleanup()
      reject(new Error("tunnel closed before returning ClientHello bytes"))
    }
    const data = (chunk: Buffer) => {
      chunks.push(chunk)
      const result = Buffer.concat(chunks)
      if (result.length < length) return
      cleanup()
      resolve(result)
    }
    socket.on("data", data)
    socket.once("error", error)
    socket.once("close", closed)
  })
}

describe("sandbox trusted proxy", () => {
  test("allows only authenticated exact destinations", async () => {
    const target = upstream()
    const port = target.port!
    const calls: string[] = []
    const proxy = await startProxy([`allowed.test:${port}`], "darwin", resolver(port, calls))
    close.push(proxy.close)

    const allowed = await fetch(`http://allowed.test:${port}/allowed`, { proxy: proxy.url })
    const denied = await fetch(`http://blocked.allowed.test:${port}/blocked`, { proxy: proxy.url })
    const unauthenticated = await fetch(`http://allowed.test:${port}/unauthenticated`, {
      proxy: proxy.url.replace(/kilo:[^@]+@/, ""),
    })

    expect(allowed.status).toBe(200)
    expect(await allowed.text()).toBe("/allowed")
    expect(denied.status).toBe(403)
    expect(unauthenticated.status).toBe(407)
    expect(calls).toEqual([`allowed.test:${port}`])
  })

  test("forwards CONNECT only when SNI matches the authorized host", async () => {
    const upstream = target()
    const calls: string[] = []
    const proxy = await startProxy([`allowed.test:${upstream.port}`], "darwin", resolver(upstream.port, calls))
    close.push(proxy.close)
    const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
    const input = Buffer.concat([hello("ALLOWED.TEST"), record(20, Buffer.from([1]), 3)])
    const output = receive(socket, input.length)
    socket.write(input)

    expect(await output).toEqual(input)
    expect(upstream.accepted()).toBe(1)
    expect(upstream.bytes()).toEqual(input)
    expect(calls).toEqual([`allowed.test:${upstream.port}`])
  })

  test("preserves fragmented ClientHello before opening CONNECT upstream", async () => {
    const upstream = target()
    const calls: string[] = []
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const resolve: ProxyResolver = async (dest) => {
      calls.push(dest.authority)
      started.resolve()
      await gate.promise
      return { address: "127.0.0.1", family: 4 }
    }
    const proxy = await startProxy([`allowed.test:${upstream.port}`], "darwin", resolve)
    close.push(proxy.close)
    const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
    const input = fragmented(hello("allowed.test"))
    const parser = new TlsClientHello("allowed.test")

    for (const byte of input.subarray(0, -1)) {
      expect(parser.push(Buffer.from([byte]))).toBe("pending")
    }
    expect(parser.push(input.subarray(-1))).toBe("valid")
    expect(parser.bytes()).toEqual(input)

    const output = receive(socket, input.length)
    socket.write(input)
    await started.promise

    expect(upstream.accepted()).toBe(0)
    expect(upstream.bytes()).toHaveLength(0)
    expect(calls).toEqual([`allowed.test:${upstream.port}`])
    gate.resolve()

    expect(await output).toEqual(input)
    expect(upstream.accepted()).toBe(1)
    expect(upstream.bytes()).toEqual(input)
  })

  test("rejects mismatched and absent CONNECT SNI before reaching upstream", async () => {
    const upstream = target()
    const calls: string[] = []
    const proxy = await startProxy([`allowed.test:${upstream.port}`], "darwin", resolver(upstream.port, calls))
    close.push(proxy.close)

    for (const input of [hello("blocked.test"), hello()]) {
      const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
      const end = closed(socket)
      socket.write(input)
      await end
    }

    expect(upstream.accepted()).toBe(0)
    expect(upstream.bytes()).toHaveLength(0)
    expect(calls).toEqual([])
  })

  test("fails closed on malformed, truncated, oversized, and encrypted ClientHello", async () => {
    const upstream = target()
    const calls: string[] = []
    const proxy = await startProxy([`allowed.test:${upstream.port}`], "darwin", resolver(upstream.port, calls))
    close.push(proxy.close)
    const malformed = hello("allowed.test")
    malformed.writeUInt16BE(0xffff, 50)
    const oversized = Buffer.from([22, 3, 1, 0, 4, 1, 1, 0, 0])
    const encrypted = hello("allowed.test", [extension(0xfe0d, Buffer.from([0]))])
    const early = hello("allowed.test", [extension(42, Buffer.alloc(0))])

    for (const input of [Buffer.from("GET /"), malformed, oversized, encrypted, early]) {
      const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
      const end = closed(socket)
      socket.write(input)
      await end
    }

    const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
    const end = closed(socket)
    socket.end(hello("allowed.test").subarray(0, -1))
    await end

    expect(upstream.accepted()).toBe(0)
    expect(upstream.bytes()).toHaveLength(0)
    expect(calls).toEqual([])
  })

  test("rejects application data while CONNECT resolution is pending", async () => {
    const upstream = target()
    const calls: string[] = []
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const resolve: ProxyResolver = async (dest) => {
      calls.push(dest.authority)
      started.resolve()
      await gate.promise
      return { address: "127.0.0.1", family: 4 }
    }
    const proxy = await startProxy([`allowed.test:${upstream.port}`], "darwin", resolve)
    close.push(proxy.close)
    const socket = await tunnel(proxy, `allowed.test:${upstream.port}`)
    socket.write(hello("allowed.test"))
    await started.promise

    const end = closed(socket)
    socket.write(record(23, Buffer.from([0]), 3))
    await end
    gate.resolve()
    await Bun.sleep(0)

    expect(upstream.accepted()).toBe(0)
    expect(upstream.bytes()).toHaveLength(0)
    expect(calls).toEqual([`allowed.test:${upstream.port}`])
  })

  test("rechecks redirect destinations without resolving denied hosts", async () => {
    let requests = 0
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests++
        return Response.redirect(`http://blocked.test:${new URL(request.url).port}/exfiltrate`, 302)
      },
    })
    close.push(() => target.stop(true))
    const port = target.port!
    const calls: string[] = []
    const proxy = await startProxy([`allowed.test:${port}`], "darwin", resolver(port, calls))
    close.push(proxy.close)

    const response = await fetch(`http://allowed.test:${port}/redirect`, { proxy: proxy.url })
    expect(response.status).toBe(403)
    expect(requests).toBe(1)
    expect(calls).toEqual([`allowed.test:${port}`])
  })

  posix("creates a private Unix listener for Linux relay mode", async () => {
    const target = upstream()
    const port = target.port!
    const proxy = await startProxy([`allowed.test:${port}`], "linux", resolver(port, []))
    close.push(proxy.close)
    expect(proxy.socket).toContain("kilo-sandbox-proxy-")
    expect(proxy.port).toBeGreaterThan(0)
    expect((await lstat(proxy.socket!)).isSocket()).toBe(true)
  })
})
