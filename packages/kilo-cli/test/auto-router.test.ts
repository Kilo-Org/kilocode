import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// Custom auto routers end to end (ADR 0005, v1 #15183): the host, the Gateway plugin, the session `route` hook, and
// the `routers.*` RPC methods are real. Only the HTTP peers are local: the Kilo API and routing worker fixture, and
// an OpenAI-compatible server for the client model.
const router = { providerID: "kilo", id: "kilo-auto/custom/myrouter" }

test("registers a client model and routes a custom router request to it", async () => {
  using backend = fixture()
  using local = openai()
  const data = (backend.state.models as { data: unknown[] }).data
  data.push({
    id: router.id,
    name: "My Router",
    context_length: 128000,
    max_completion_tokens: 8192,
    supported_parameters: ["tools"],
    isFree: false,
  })
  const config = {
    providers: {
      local: {
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${local.url}/v1`, apiKey: "local-key" },
        models: { echo: { name: "Echo", limit: { context: 32000, output: 4000 } } },
      },
    },
  }
  await run(backend.url, config, async (client, directory) => {
    const rpc = client.rpc(KiloGatewayRpc.Definition)
    const options = { location: { directory } }
    const added = (await rpc["routers.add"]({ router: "myrouter", model: "local/echo" }, options)) as {
      router: { modelId: string; entries: { key: string; entry: Record<string, unknown> }[] }
    }
    expect(added.router.modelId).toBe(router.id)
    expect(added.router.entries.find((item) => item.key === "client:local/echo")?.entry).toMatchObject({
      kind: "client",
      provider: "local",
      model: "echo",
      capabilities: { contextLength: 32000, toolCall: true },
    })

    const session = await client.session.create({ location: { directory }, model: router })
    await client.session.prompt({ sessionID: session.id, text: "Say hi." })
    await client.session.wait({ sessionID: session.id })
    const messages = await client.session.context({ sessionID: session.id })
    const assistant = messages.find((message) => message.type === "assistant")
    expect(assistant?.type === "assistant" ? assistant.error : "missing").toBeUndefined()
    // Durable records keep the selected router; the request went to the client model.
    expect(assistant?.type === "assistant" ? assistant.model : undefined).toMatchObject(router)
    expect(assistant?.type === "assistant" ? assistant.content : []).toContainEqual({
      type: "text",
      text: "Local answer",
    })
    // The step records the client model as the routed model, as the Gateway stream does for Gateway picks.
    expect(assistant?.type === "assistant" ? assistant.native : undefined).toMatchObject({
      kilo: { routedModelID: "echo" },
    })
    expect(local.requests.map((request) => request.model)).toContain("echo")
    expect(local.requests[0]?.authorization).toBe("Bearer local-key")
    const decide = backend.state.customRouterBodies.find((item) => item.path === "/v1/decide")?.body as {
      model: string
      sessionId: string
      mode: string
      clientRequestId: string
      clientEntries: unknown[]
      messages: { role: string; content: unknown }[]
      tools?: unknown[]
    }
    expect(decide).toMatchObject({
      model: router.id,
      sessionId: session.id,
      mode: "code",
      clientEntries: [{ provider: "local", model: "echo" }],
    })
    // As on v1: the conversation without the agent system prompt, and the user message ID as the client request ID.
    expect(decide.messages.map((message) => message.role)).toEqual(["user"])
    expect(decide.clientRequestId).toMatch(/^msg_/)
    expect(decide.messages).toContainEqual({ role: "user", content: [{ type: "text", text: "Say hi." }] })
    expect(decide.tools?.length).toBeGreaterThan(0)

    // A worker error fails the execution with the specific message instead of routing elsewhere.
    backend.state.decideStatus = 402
    backend.state.decide = { error: { code: "insufficient_balance", message: "no credit" } }
    await client.session.prompt({ sessionID: session.id, text: "Again." })
    await client.session.wait({ sessionID: session.id })
    expect((await client.session.get({ sessionID: session.id })).outcome).toBe("failed")
    // The title request of the first prompt can still reach the client model, so check the prompt, not the count.
    expect(local.requests.some((request) => request.body.includes("Again."))).toBe(false)
    backend.state.decideStatus = 200
    backend.state.decide = undefined

    await rpc["routers.remove"]({ router: router.id, model: "local/echo" }, options)
    const listed = (await rpc["routers.list"]({}, options)) as { routers: { entries: { key: string }[] }[] }
    expect(listed.routers[0]?.entries.map((item) => item.key)).toEqual(["gateway:anthropic/claude-sonnet-4.6"])

    const missing = await rpc["routers.add"]({ router: "myrouter", model: "local/missing" }, options).catch(
      (error: unknown) => error,
    )
    expect(missing).toMatchObject({ type: "router", message: expect.stringContaining("is not configured in this CLI") })
  })
}, 30_000)

async function run(
  url: string,
  config: unknown,
  body: (client: ReturnType<typeof OpenCode.make>, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-auto-router-"))
  const variables = {
    KILO_API_URL: url,
    KILO_AUTO_ROUTING_URL: url,
    KILO_API_KEY: "fixture-token",
    KILOCODE_TOKEN: undefined,
    KILO_AUTH_CONTENT: undefined,
    KILO_ORG_ID: undefined,
    KILO_AI_GATEWAY_URL: undefined,
  }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory, project: false, content: JSON.stringify(config) },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const client = OpenCode.make({
            baseUrl: "http://kilo.local",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          // Wait for the catalog activation that a real client waits for.
          yield* Effect.promise(() => client.rpc(KiloGatewayRpc.Definition).models({}, { location: { directory } }))
          yield* Effect.promise(() => body(client, directory))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    apply(previous)
    await rm(directory, { recursive: true, force: true })
  }
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

// An OpenAI-compatible Chat Completions server that streams one text answer.
function openai() {
  const requests: { model: string; authorization: string | null; body: string }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const text = await request.text()
      const body = JSON.parse(text) as { model: string }
      requests.push({ model: body.model, authorization: request.headers.get("authorization"), body: text })
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      return new Response(
        [
          chunk({ role: "assistant", content: "Local answer" }, null),
          chunk({}, "stop"),
          `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return { requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}
