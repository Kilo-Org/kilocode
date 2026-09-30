import { describe as group, expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { NetworkRpc, type NetworkResolved, type NetworkWait } from "@opencode-ai/schema/kilocode/network"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { describe, dial, disconnected } from "../src/network-policy"
import type { Layout } from "../src/paths"
import { fixture } from "./fixture"

group("network error detection", () => {
  test("classifies every transport failure as a possible disconnect", () => {
    expect(disconnected({ type: "provider.transport", message: "anything" })).toBe(true)
  })

  test("detects common network disconnect codes in unclassified errors", () => {
    for (const code of [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ENETDOWN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
      "ERR_SOCKET_CONNECTION_TIMEOUT",
    ])
      expect(disconnected({ type: "provider.unknown", message: `${code}: request failed` })).toBe(true)
  })

  test("detects browser-style and provider transient network messages", () => {
    for (const message of [
      "Load failed",
      "Failed to fetch",
      "fetch failed",
      "The network connection was lost.",
      "socket hang up",
      "Unable to connect. Is the computer able to access the url?",
      "TimeoutError: The operation timed out.",
    ])
      expect(disconnected({ type: "provider.unknown", message })).toBe(true)
  })

  test("ignores failures that are not about the network", () => {
    expect(disconnected({ type: "provider.rate-limit", message: "Too many requests" })).toBe(false)
    expect(disconnected({ type: "provider.auth", message: "Invalid API key" })).toBe(false)
  })

  test("describes the failure the way v1 did", () => {
    const text = (message: string) => describe({ type: "provider.transport", message })
    expect(text("ConnectionRefused: Unable to connect. Is the computer able to access the url?")).toBe(
      "Connection refused",
    )
    expect(text("ECONNRESET: The socket connection was closed unexpectedly.")).toBe("Connection reset by server")
    expect(text("getaddrinfo ENOTFOUND api.example.com")).toBe("Host not found")
    expect(text("TimeoutError: The operation timed out.")).toBe("Request timed out")
    expect(text("fetch failed")).toBe("Network request failed")
    expect(text("something else")).toBe("Network connection failed")
  })
})

test("holds a retrying step while offline and resumes after reconnect", async () => {
  await using input = await fixture()
  const provider = await createProvider()
  const location = { location: { directory: input.cwd } }
  const resumeMs = 1_000
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* launch(networkLayout(input, "network"), {
            models: false,
            recover: false,
            // Loopback only: the fixture never reaches the public probe endpoints.
            network: { probe: (endpoint) => (endpoint ? dial(endpoint) : Promise.resolve(false)), pollMs: 50, resumeMs },
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `${provider.origin}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: host.url,
            headers: { authorization: `Basic ${btoa(`opencode:${host.auth.password}`)}` },
          })
          yield* Effect.promise(() => client.plugin.awaitActivation(location))
          const rpc = client.rpc(NetworkRpc)
          const events: Array<{ name: "asked" | "restored"; data: NetworkWait; at: number }> = []
          const resolutions: Array<{ data: NetworkResolved; at: number }> = []
          const controller = new AbortController()
          for (const name of ["asked", "restored"] as const)
            rpc.events.on(
              name,
              (event) => {
                events.push({ name, data: event.data, at: Date.now() })
              },
              { signal: controller.signal },
            )
          rpc.events.on(
            "resolved",
            (event) => {
              resolutions.push({ data: event.data, at: Date.now() })
            },
            { signal: controller.signal },
          )
          const find = (sessionID: string, name: "asked" | "restored") =>
            events.find((event) => event.data.sessionID === sessionID && event.name === name)
          const resolved = (sessionID: string) => resolutions.find((event) => event.data.sessionID === sessionID)
          const start = async (title: string) => {
            const session = await client.session.create({
              ...location,
              title,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            })
            await client.session.prompt({ sessionID: session.id, text: title })
            return session.id
          }
          const reply = async (sessionID: string) => {
            await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(10_000) })
            const messages = (await client.message.list({ sessionID, order: "asc" })).data
            return messages.flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
                : [],
            )
          }

          yield* Effect.promise(async () => {
            // Offline, then reconnect: the countdown elapses and the held step retries.
            await provider.stop()
            const auto = await start("auto resume")
            const asked = await until(() => find(auto, "asked"), "asked", events)
            expect(asked.data.message).toBe("Connection refused")
            expect(asked.data.restored).toBe(false)
            expect((await rpc.list({}, location)).waits.map((wait) => wait.id)).toEqual([asked.data.id])
            await Bun.sleep(200)
            expect(find(auto, "restored")).toBeUndefined()
            await provider.start()
            const restored = await until(() => find(auto, "restored"), "restored", events)
            expect(restored.data.restored).toBe(true)
            expect(restored.data.time.resume).toBe(restored.data.time.restored! + resumeMs)
            const resumed = await until(() => resolved(auto), "resolved", events)
            expect(resumed.data).toMatchObject({ id: asked.data.id, outcome: "resumed" })
            expect(resumed.at - restored.at).toBeGreaterThanOrEqual(resumeMs - 100)
            expect(await reply(auto)).toEqual(["Fixture complete"])
            expect((await rpc.list({}, location)).waits).toEqual([])

            // Resume skips the reconnect countdown.
            await provider.stop()
            const manual = await start("manual resume")
            const held = await until(() => find(manual, "asked"), "asked", events)
            await provider.start()
            const back = await until(() => find(manual, "restored"), "restored", events)
            expect(await rpc.resume({ id: held.data.id }, location)).toEqual({ resumed: true })
            const done = await until(() => resolved(manual), "resolved", events)
            expect(done.data.outcome).toBe("resumed")
            expect(done.at - back.at).toBeLessThan(resumeMs / 2)
            expect(await reply(manual)).toEqual(["Fixture complete"])
            expect(await rpc.resume({ id: held.data.id }, location)).toEqual({ resumed: false })

            // Interrupting the session cancels the wait without retrying.
            await provider.stop()
            const cancelled = await start("interrupt")
            await until(() => find(cancelled, "asked"), "asked", events)
            await client.session.interrupt({ sessionID: cancelled })
            const stopped = await until(() => resolved(cancelled), "resolved", events)
            expect(stopped.data.outcome).toBe("cancelled")
            await client.session.wait({ sessionID: cancelled }, { signal: AbortSignal.timeout(10_000) })
            expect(find(cancelled, "restored")).toBeUndefined()
            expect((await rpc.list({}, location)).waits).toEqual([])

            // A reachable provider that drops the stream keeps native backoff: no wait is shown.
            await provider.start()
            provider.dropNext()
            const flaky = await start("reachable provider")
            expect((await reply(flaky)).at(-1)).toBe("Fixture complete")
            expect(find(flaky, "asked")).toBeUndefined()
            expect(provider.requests()).toBeGreaterThanOrEqual(2)
          })
          controller.abort()
        }),
      ),
    )
  } finally {
    await provider.stop()
  }
}, 60_000)

test("reconnects failed MCP servers once the held step resumes", async () => {
  await using input = await fixture()
  const provider = await createProvider()
  const marker = path.join(input.directory, "mcp-online")
  const server = path.join(input.directory, "mcp-server.mjs")
  await Bun.write(server, MCP_SERVER)
  const location = { location: { directory: input.cwd } }
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* launch(networkLayout(input, "mcp"), {
            models: false,
            recover: false,
            network: { probe: (endpoint) => (endpoint ? dial(endpoint) : Promise.resolve(false)), pollMs: 50, resumeMs: 0 },
            content: JSON.stringify({
              model: "fixture/chat",
              mcp: {
                servers: {
                  flaky: { type: "local", command: [process.execPath, server], environment: { MCP_MARKER: marker } },
                },
              },
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `${provider.origin}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
          })
          const client = createClient({
            baseUrl: host.url,
            headers: { authorization: `Basic ${btoa(`opencode:${host.auth.password}`)}` },
          })
          yield* Effect.promise(async () => {
            await client.plugin.awaitActivation(location)
            const status = async () =>
              (await client.mcp.list(location)).data.find((item) => item.name === "flaky")?.status.status
            const settle = async (expected: string) => {
              for (let attempt = 0; attempt < 400; attempt++) {
                if ((await status()) === expected) return
                await Bun.sleep(25)
              }
              throw new Error(`MCP server never reached ${expected}: ${await status()}`)
            }
            await settle("failed")

            const rpc = client.rpc(NetworkRpc)
            const asked: NetworkWait[] = []
            const controller = new AbortController()
            rpc.events.on(
              "asked",
              (event) => {
                asked.push(event.data)
              },
              { signal: controller.signal },
            )
            await provider.stop()
            const session = await client.session.create({
              ...location,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            })
            await client.session.prompt({ sessionID: session.id, text: "reconnect mcp" })
            await until(() => asked.find((wait) => wait.sessionID === session.id), "asked", asked)
            // The server could start now, but nothing reconnects it until the network wait resolves.
            await Bun.write(marker, "online")
            await Bun.sleep(200)
            expect(await status()).toBe("failed")
            await provider.start()
            await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
            await settle("connected")
            controller.abort()
          })
        }),
      ),
    )
  } finally {
    await provider.stop()
  }
}, 60_000)

// Exits until its marker exists, then answers the minimal MCP stdio handshake.
const MCP_SERVER = `
import { existsSync } from "node:fs"
import { createInterface } from "node:readline"
if (!existsSync(process.env.MCP_MARKER)) process.exit(1)
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined || message.id === null) return
  if (message.method === "initialize")
    return respond(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "flaky", version: "0.0.0" },
    })
  if (message.method === "tools/list") return respond(message.id, { tools: [] })
  return respond(message.id, {})
})
`

async function until<T>(read: () => T | undefined, label: string, events: unknown[]) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = read()
    if (value !== undefined) return value
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(events)}`)
}

// A loopback OpenAI-compatible provider on a fixed port that can go offline (port closed) and back.
async function createProvider() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) })
  const port = probe.port!
  await probe.stop(true)
  let server: ReturnType<typeof Bun.serve> | undefined
  let drop = false
  let count = 0
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id: "network", object: "chat.completion.chunk", model: "chat", created: 1, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  return {
    origin: `http://127.0.0.1:${port}`,
    requests: () => count,
    dropNext: () => {
      drop = true
    },
    start: async () => {
      server ??= Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch(request) {
          if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
          count++
          if (drop) {
            drop = false
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(chunk({ role: "assistant", content: "partial " }, null)))
                  setTimeout(() => controller.error(new Error("fixture socket drop")), 50)
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            )
          }
          return new Response(
            chunk({ role: "assistant", content: "Fixture complete" }, null) + chunk({}, "stop") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      })
    },
    stop: async () => {
      await server?.stop(true)
      server = undefined
    },
  }
}

function networkLayout(input: { home: string; directory: string }, prefix: string): Layout {
  return {
    channel: "interactive",
    paths: {
      home: input.home,
      data: path.join(input.directory, `${prefix}-data`),
      config: path.join(input.directory, `${prefix}-config`),
      cache: path.join(input.directory, `${prefix}-cache`),
      state: path.join(input.directory, `${prefix}-state`),
      tmp: path.join(input.directory, `${prefix}-tmp`),
      bin: path.join(input.directory, `${prefix}-cache`, "bin"),
      log: path.join(input.directory, `${prefix}-data`, "log"),
      repos: path.join(input.directory, `${prefix}-data`, "repos"),
    },
    roots: [],
    database: path.join(input.directory, `${prefix}-data`, "kilo2.db"),
    config: path.join(input.directory, `${prefix}-config`, "kilo.jsonc"),
    tuiConfig: path.join(input.directory, `${prefix}-config`, "tui.json"),
    telemetryConfig: path.join(input.directory, `${prefix}-config`, "telemetry.json"),
    password: path.join(input.directory, `${prefix}-state`, "server.password"),
    pty: path.join(input.directory, `${prefix}-tmp`, "pty"),
  }
}
