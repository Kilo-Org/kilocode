import { expect, test } from "bun:test"
import { createConnection } from "node:net"
import { OpenCode } from "@opencode-ai/client"
import { compiledBinary, fixture, readyProcess, start } from "./fixture"

for (const mode of ["source", "compiled"] as const) {
  test(`${mode}: rejects an unauthenticated partial upload without waiting for its body`, async () => {
    await using server = await live(mode)
    using upload = incomplete(server.url)
    await within(upload.sent, 2000)
    const response = await within(upload.response, 2000)
    expect(response).toMatch(/^HTTP\/1\.1 401 /)
    expect(response.toLowerCase()).toContain("www-authenticate: basic")
    await within(upload.closed, 2000)
    const malformed = await fetch(`${server.url}/api/session`, {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    })
    expect(malformed.status).toBe(401)
    expect(await server.client.session.active()).toEqual({})
  })

  test(`${mode}: bounds authenticated uploads even while bytes keep arriving`, async () => {
    await using server = await live(mode)
    using upload = incomplete(server.url, server.authorization)
    await within(upload.sent, 2000)
    const began = performance.now()
    const response = await within(upload.response, 8000)
    await within(upload.closed, 2000)
    expect(performance.now() - began).toBeGreaterThanOrEqual(4500)
    expect(response === "" || response.startsWith("HTTP/1.1 408 ")).toBe(true)
    expect(server.child.exitCode).toBeNull()
    expect(await server.client.session.active()).toEqual({})
  })

  test(`${mode}: accepts complete chunked JSON without changing its text`, async () => {
    await using server = await live(mode)
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        title: "Résumé",
        location: { directory: server.directory },
      }),
    )
    const response = await fetch(`${server.url}/api/session`, {
      method: "POST",
      headers: { authorization: server.authorization, "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          bytes.forEach((byte) => controller.enqueue(Uint8Array.of(byte)))
          controller.close()
        },
      }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).data.title).toBe("Résumé")
    expect(await server.client.session.active()).toEqual({})
  })

  test(`${mode}: shuts down with both an SSE subscriber and an incomplete upload`, async () => {
    await using server = await live(mode)
    const controller = new AbortController()
    const events = server.client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    try {
      const connected = await within(events.next(), 2000)
      expect(connected.done).toBe(false)
      expect(connected.value?.type).toBe("server.connected")
      using upload = incomplete(server.url, server.authorization)
      await within(upload.sent, 2000)
      expect(await server.client.session.active()).toEqual({})
      server.child.kill(mode === "source" ? "SIGINT" : "SIGTERM")
      expect(await within(server.child.exited, 3000), await server.errors).toBe(0)
      await within(upload.closed, 2000)
    } finally {
      controller.abort()
      await events.return?.(undefined).catch(() => undefined)
    }
  })
}

async function live(mode: "source" | "compiled") {
  const binary = mode === "compiled" ? compiledBinary() : undefined
  const input = await fixture(binary)
  const child = start(input, ["serve"])
  const errors = new Response(child.stderr).text()
  try {
    const listening = await readyProcess(child, /URL: (http:\/\/127\.0\.0\.1:\d+)/, errors)
    const password = (await Bun.file(input.layout.password).text()).trim()
    const authorization = `Basic ${btoa(`opencode:${password}`)}`
    return {
      child,
      errors,
      url: listening.value,
      directory: input.cwd,
      authorization,
      client: OpenCode.make({ baseUrl: listening.value, headers: { authorization } }),
      async [Symbol.asyncDispose]() {
        child.kill("SIGTERM")
        await child.exited
        await input[Symbol.asyncDispose]()
      },
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    await input[Symbol.asyncDispose]()
    throw error
  }
}

function incomplete(baseUrl: string, authorization?: string) {
  const url = new URL(baseUrl)
  const socket = createConnection({ host: url.hostname, port: Number(url.port) })
  const sent = Promise.withResolvers<void>()
  const response = Promise.withResolvers<string>()
  const closed = Promise.withResolvers<void>()
  const chunks: string[] = []
  socket.setEncoding("utf8")
  socket.once("connect", () => {
    socket.write(
      [
        "POST /api/session HTTP/1.1",
        `Host: ${url.host}`,
        "Content-Type: application/json",
        "Content-Length: 4096",
        ...(authorization ? [`Authorization: ${authorization}`] : []),
        "",
        "{",
      ].join("\r\n"),
    )
    sent.resolve()
  })
  socket.on("data", (chunk: string) => {
    chunks.push(chunk)
    const text = chunks.join("")
    if (text.includes("\r\n\r\n")) response.resolve(text)
  })
  const drip = setInterval(() => {
    if (!socket.connecting && !socket.destroyed) socket.write(" ")
  }, 200)
  socket.once("close", () => {
    clearInterval(drip)
    response.resolve(chunks.join(""))
    closed.resolve()
  })
  socket.once("error", (error: NodeJS.ErrnoException) => {
    sent.reject(error)
    if (error.code !== "ECONNRESET") response.reject(error)
  })
  void sent.promise.catch(() => undefined)
  void response.promise.catch(() => undefined)
  return {
    sent: sent.promise,
    response: response.promise,
    closed: closed.promise,
    [Symbol.dispose]() {
      clearInterval(drip)
      socket.destroy()
    },
  }
}

async function within<T>(promise: Promise<T>, milliseconds: number) {
  const result = Promise.withResolvers<T>()
  const timer = setTimeout(() => result.reject(new Error(`Operation exceeded ${milliseconds}ms`)), milliseconds)
  promise.then(result.resolve, result.reject)
  try {
    return await result.promise
  } finally {
    clearTimeout(timer)
  }
}
