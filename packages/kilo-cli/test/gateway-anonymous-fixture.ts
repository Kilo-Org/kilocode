import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"

const input = guardedFixtureLayout()
const scenario = process.env.KILO_ANONYMOUS_SCENARIO ?? "available"
const catalogGate = Promise.withResolvers<void>()
const requests: Array<{ path: string; authorization: string | null; organization: string | null }> = []
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    requests.push({
      path: pathname,
      authorization: request.headers.get("authorization"),
      organization: request.headers.get("x-kilocode-organizationid"),
    })
    if (pathname === "/api/openrouter/models" && scenario === "background") await catalogGate.promise
    if (pathname === "/api/openrouter/models" && scenario === "failed") return new Response(null, { status: 503 })
    if (pathname === "/api/openrouter/models" && scenario === "empty") return Response.json({ data: [] })
    if (pathname === "/api/openrouter/models")
      return Response.json({
        data: [
          {
            id: "anonymous-fixture",
            name: "Anonymous Kilo Fixture",
            isFree: true,
            context_length: 128000,
            supported_parameters: ["tools"],
            opencode: { ai_sdk_provider: "openai-compatible" },
          },
          {
            id: "paid-fixture",
            name: "Paid Fixture",
            isFree: false,
            context_length: 128000,
            supported_parameters: ["tools"],
          },
        ],
      })
    if (pathname !== "/api/gateway/chat/completions") return new Response(null, { status: 404 })
    const body = await request.json()
    assert.equal(body.model, "anonymous-fixture")
    const frames = [
      {
        id: "anonymous-response",
        object: "chat.completion.chunk",
        created: 1,
        model: "anonymous-fixture",
        choices: [{ index: 0, delta: { role: "assistant", content: "Anonymous Kilo reply" }, finish_reason: null }],
      },
      {
        id: "anonymous-response",
        object: "chat.completion.chunk",
        created: 1,
        model: "anonymous-fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
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
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin, backgroundRefresh: scenario === "background" },
          content: JSON.stringify({
            providers: {
              kilo: { models: { "seed-paid": { name: "Seed Paid", disabled: false } } },
              opencode: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { "zen-fixture": { name: "OpenCode Zen Fixture" } },
              },
            },
          }),
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(async () => {
          const activation = client.plugin.awaitActivation({ location })
          const earlySession =
            scenario === "background"
              ? await client.session.create({ location, model: { providerID: "kilo", id: "anonymous-fixture" } })
              : undefined
          const earlyPrompt = earlySession
            ? client.session.prompt({ sessionID: earlySession.id, text: "Reply once" })
            : undefined
          if (scenario === "background") {
            assert(
              !(await client.model.list({ location })).data.some(
                (model) => model.providerID === "kilo" || model.providerID === "opencode",
              ),
            )
            assert.equal((await client.message.list({ sessionID: earlySession!.id, order: "asc" })).data.length, 0)
            catalogGate.resolve()
            const deadline = Date.now() + 5000
            while (!(await client.model.list({ location })).data.some((model) => model.id === "anonymous-fixture")) {
              assert(Date.now() < deadline, "Background catalog did not arrive")
              await Bun.sleep(10)
            }
          }
          await activation
          const integrations = (await client.integration.list({ location })).data
          assert.equal(integrations.find((integration) => integration.id === "kilo")?.connections.length, 0)
          const catalog = (await client.model.list({ location })).data
          if (scenario === "empty" || scenario === "failed") {
            assert(
              !catalog.some((model) => model.providerID === "kilo"),
              "empty/failed anonymous catalog exposed seed models",
            )
            assert(!catalog.some((model) => model.providerID === "opencode"), "Zen became the signed-out fallback")
            return
          }
          assert(catalog.some((model) => model.providerID === "kilo" && model.id === "anonymous-fixture"))
          assert(!catalog.some((model) => model.providerID === "opencode"))
          assert(!catalog.some((model) => model.providerID === "kilo" && model.id === "paid-fixture"))
          const metadata = await client.rpc(KiloModels.Definition).list({}, { location })
          assert(metadata.some((model) => model.id === "anonymous-fixture"))
          const selected = (await client.model.default({ location })).data
          assert.equal(selected?.providerID, "kilo")
          assert.equal(selected?.id, "anonymous-fixture")
          const session = earlySession ?? (await client.session.create({ location, title: "Anonymous fixture" }))
          await (earlyPrompt ?? client.session.prompt({ sessionID: session.id, text: "Reply once" }))
          await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
          const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data
          assert(
            messages.some(
              (message) =>
                message.type === "assistant" &&
                message.content.some((part) => part.type === "text" && part.text === "Anonymous Kilo reply"),
            ),
          )
          assert(
            !requests.some((request) => request.path === "/api/profile" || request.path.includes("/organizations/")),
          )
          assert(
            requests
              .filter((request) => request.path === "/api/openrouter/models")
              .every((request) => request.authorization === null),
          )
          const completions = requests.filter((request) => request.path === "/api/gateway/chat/completions")
          assert(completions.length > 0)
          assert(
            completions.every(
              (request) => request.authorization === "Bearer anonymous" && request.organization === null,
            ),
          )
        })
      }).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
    ),
  )
  console.log("GATEWAY_ANONYMOUS_OK")
} finally {
  catalogGate.resolve()
  gateway.stop(true)
}
