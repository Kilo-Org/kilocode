import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const requested: Array<{ model: string; reasoningEffort: unknown }> = []
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile") return Response.json({ organizations: [], hasPersonalAccount: true })
    if (url.pathname === "/api/openrouter/models")
      return Response.json({
        data: [
          {
            id: "kilo-auto/free",
            name: "Kilo Auto Free",
            context_length: 128000,
            supported_parameters: ["tools"],
            opencode: { variants: { high: { reasoningEffort: "high" } } },
          },
          { id: "ordinary", name: "Ordinary", context_length: 128000, supported_parameters: ["tools"] },
        ],
      })
    if (url.pathname !== "/api/gateway/chat/completions") return new Response(null, { status: 404 })
    assert.equal(request.headers.get("authorization"), "Bearer fixture-only")
    const body = (await request.json()) as { model?: string; reasoning_effort?: unknown; stream?: boolean }
    requested.push({ model: body.model ?? "", reasoningEffort: body.reasoning_effort })
    if (!body.stream)
      return Response.json({
        id: "routed-fixture",
        object: "chat.completion",
        created: 1,
        model: "provider/actual",
        choices: [{ index: 0, message: { role: "assistant", content: "Fixture title" }, finish_reason: "stop" }],
      })
    const frames = [
      {
        id: "routed-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "provider/actual",
        choices: [{ index: 0, delta: { role: "assistant", content: "Routed fixture response" }, finish_reason: null }],
      },
      {
        id: "routed-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "provider/actual",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ]
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = layout("interactive")
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin },
          content: JSON.stringify({
            model: "kilo/kilo-auto/free",
            providers: {
              kilo: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { ordinary: {} },
              },
            },
          }),
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        const plugins = yield* Effect.promise(() => client.plugin.list({ location }))
        assert(
          plugins.data.some((plugin) => plugin.id === "kilocode.routed-model"),
          JSON.stringify(plugins),
        )
        yield* Effect.promise(() => client.integration.connect.key({ integrationID: "kilo", key: "fixture-only" }))
        const inventory = yield* Effect.promise(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const inventory = await client.model.list({ location })
            if (inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"))
              return inventory
            await Bun.sleep(20)
          }
          return client.model.list({ location })
        })
        assert(
          inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"),
          JSON.stringify(inventory),
        )
        assert.deepEqual(
          inventory.data.find((model) => model.providerID === "kilo" && model.id === "kilo-auto/free")?.variants,
          [{ id: "high", settings: { reasoningEffort: "high" } }],
        )
        const auto = yield* Effect.promise(() =>
          client.session.create({ location, model: { providerID: "kilo", id: "kilo-auto/free", variant: "high" } }),
        )
        yield* Effect.promise(() => client.session.prompt({ sessionID: auto.id, text: "Route this Auto request" }))
        yield* Effect.promise(() => client.session.wait({ sessionID: auto.id }, { signal: AbortSignal.timeout(10000) }))
        const autoAssistant = (yield* Effect.promise(() => client.message.list({ sessionID: auto.id }))).data.find(
          (message) => message.type === "assistant",
        )
        assert.equal(autoAssistant?.type, "assistant")
        assert.deepEqual(
          autoAssistant.providerState,
          { routedModelID: "provider/actual" },
          JSON.stringify({ autoAssistant, requested }),
        )

        const ordinary = yield* Effect.promise(() =>
          client.session.create({ location, model: { providerID: "kilo", id: "ordinary" } }),
        )
        yield* Effect.promise(() =>
          client.session.prompt({ sessionID: ordinary.id, text: "Leave this ordinary request alone" }),
        )
        yield* Effect.promise(() =>
          client.session.wait({ sessionID: ordinary.id }, { signal: AbortSignal.timeout(10000) }),
        )
        const ordinaryAssistant = (yield* Effect.promise(() =>
          client.message.list({ sessionID: ordinary.id }),
        )).data.find((message) => message.type === "assistant")
        assert.equal(ordinaryAssistant?.type, "assistant")
        assert.equal(ordinaryAssistant.providerState, undefined)
        assert(
          requested.some((item) => item.model === "kilo-auto/free" && item.reasoningEffort === "high"),
          JSON.stringify(requested),
        )
        assert(requested.some((item) => item.model === "ordinary"))
        assert(!requested.some((item) => item.model === "provider/actual"))
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("ROUTED_MODEL_INTEGRATION_OK")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await gateway.stop(true)
}
