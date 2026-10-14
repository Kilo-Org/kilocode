import { afterEach, expect, test } from "bun:test"
import net from "node:net"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "@/server/server"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"

const password = Flag.KILO_SERVER_PASSWORD

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = password
  await disposeAllInstances()
  await resetDatabase()
})

function config(url: URL) {
  return {
    model: "test/test-model",
    small_model: "test/test-model",
    enabled_providers: ["test"],
    formatter: false,
    lsp: false,
    provider: {
      test: {
        name: "Test",
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey: "test-key", baseURL: `${url.origin}/v1` },
        models: { "test-model": { name: "Test", limit: { context: 100000, output: 10000 } } },
      },
    },
  }
}

function within(promise: Promise<void>, message: string) {
  const timer = Promise.withResolvers<void>()
  const id = setTimeout(() => timer.reject(new Error(message)), 5_000)
  return Promise.race([promise, timer.promise]).finally(() => clearTimeout(id))
}

// The disconnect watch must not stop a request whose client is still connected.
test("enhance-prompt returns the enhanced text to a connected client", async () => {
  Flag.KILO_SERVER_PASSWORD = undefined
  const provider = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return Response.json({
        id: "test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: "Enhanced draft" }, finish_reason: "stop" }],
      })
    },
  })
  await using tmp = await tmpdir({ config: config(provider.url) })
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })

  try {
    const response = await fetch(new URL("/enhance-prompt", listener.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify({ text: "draft prompt" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: "Enhanced draft" })
  } finally {
    await listener.stop(true)
    await provider.stop(true)
  }
}, 60_000)

// A provider failure reaches the client with the provider's own message, not a generic server error.
test("enhance-prompt returns the provider error message when the model call fails", async () => {
  Flag.KILO_SERVER_PASSWORD = undefined
  const provider = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return Response.json(
        { error: { message: "Incorrect API key provided", type: "invalid_request_error" } },
        { status: 401 },
      )
    },
  })
  await using tmp = await tmpdir({ config: config(provider.url) })
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })

  try {
    const response = await fetch(new URL("/enhance-prompt", listener.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify({ text: "draft prompt" }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: "Incorrect API key provided" })
  } finally {
    await listener.stop(true)
    await provider.stop(true)
  }
}, 60_000)

// A dropped TCP socket, not a clean fetch abort, must still stop the model call.
test("enhance-prompt aborts the model call when the client socket drops", async () => {
  Flag.KILO_SERVER_PASSWORD = undefined
  const hit = Promise.withResolvers<void>()
  const abort = Promise.withResolvers<void>()
  const provider = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      request.signal.addEventListener("abort", () => abort.resolve())
      hit.resolve()
      // Hang until the caller gives up.
      return Promise.withResolvers<Response>().promise
    },
  })
  await using tmp = await tmpdir({ config: config(provider.url) })
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  const socket = net.connect(listener.port, "127.0.0.1")

  try {
    const body = JSON.stringify({ text: "draft prompt" })
    socket.write(
      [
        "POST /enhance-prompt HTTP/1.1",
        `Host: 127.0.0.1:${listener.port}`,
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        `x-kilo-directory: ${tmp.path}`,
        "",
        body,
      ].join("\r\n"),
    )
    // The first request boots the instance, which can take a while.
    await hit.promise
    socket.destroy()
    await within(abort.promise, "the model request was not aborted after the socket dropped")
    expect(socket.destroyed).toBe(true)
  } finally {
    socket.destroy()
    await listener.stop(true)
    await provider.stop(true)
  }
}, 60_000)
