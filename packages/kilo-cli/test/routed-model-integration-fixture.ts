import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const requested: Array<{
  model: string
  reasoningEffort: unknown
  compatibleReasoningEffort: unknown
  raw: string
}> = []
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
          {
            id: "kilo-auto/compatible",
            name: "Kilo Auto Compatible",
            context_length: 128000,
            supported_parameters: ["tools"],
            opencode: {
              ai_sdk_provider: "openai-compatible",
              variants: { high: { reasoningEffort: "high" } },
            },
          },
          { id: "ordinary", name: "Ordinary", context_length: 128000, supported_parameters: ["tools"] },
        ],
      })
    if (url.pathname !== "/api/gateway/chat/completions") return new Response(null, { status: 404 })
    assert.equal(request.headers.get("authorization"), "Bearer fixture-only")
    const text = await request.text()
    const body = JSON.parse(text) as {
      model?: string
      reasoning?: { effort?: unknown }
      reasoning_effort?: unknown
      stream?: boolean
    }
    requested.push({
      model: body.model ?? "",
      reasoningEffort: body.reasoning?.effort,
      compatibleReasoningEffort: body.reasoning_effort,
      raw: text,
    })
    const responseModel = body.model === "kilo-auto/compatible" ? "provider/compatible-actual" : "provider/actual"
    if (!body.stream)
      return Response.json({
        id: "routed-fixture",
        object: "chat.completion",
        created: 1,
        model: responseModel,
        choices: [{ index: 0, message: { role: "assistant", content: "Fixture title" }, finish_reason: "stop" }],
      })
    const frames = [
      {
        id: "routed-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: responseModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "Routed fixture response" }, finish_reason: null }],
      },
      {
        id: "routed-fixture",
        object: "chat.completion.chunk",
        created: 1,
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
        // Regression: credential metadata must never leak into compiled request bodies. The
        // hostile fields mirror what device OAuth stores (profile, server, organizationID) plus
        // token material; the loopback Gateway asserts their absence below.
        yield* Effect.promise(() =>
          endpoint.importCredential({
            kind: "api-key",
            integrationID: "kilo",
            key: "fixture-only",
            label: "Fixture metadata probe",
            metadata: {
              server: gateway.url.origin,
              email: "metadata-probe@example.test",
              name: "Metadata Probe",
              organizations: "metadata-probe-org",
              organizationName: "Metadata Probe Org",
              selectedOrganizationId: "metadata-probe-org",
              hasPersonalAccount: "true",
              user: "metadata-probe-user",
              token: "metadata-probe-token",
              access: "metadata-probe-access",
              refresh: "metadata-probe-refresh",
            },
          }),
        )
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
        // Title generation runs after the first exchange settles; wait for its request to reach the
        // Gateway so the all-wire sentinel scan below always measures a title body.
        yield* Effect.promise(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (requested.some((item) => item.raw.includes("You are a title generator"))) return
            await Bun.sleep(20)
          }
        })
        const autoAssistant = (yield* Effect.promise(() => client.message.list({ sessionID: auto.id }))).data.find(
          (message) => message.type === "assistant",
        )
        assert.equal(autoAssistant?.type, "assistant")
        assert.deepEqual(
          autoAssistant.providerState,
          {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            routedModelID: "provider/actual",
          },
          JSON.stringify({ autoAssistant, requested }),
        )

        const compatible = yield* Effect.promise(() =>
          client.session.create({
            location,
            model: { providerID: "kilo", id: "kilo-auto/compatible", variant: "high" },
          }),
        )
        yield* Effect.promise(() => client.session.prompt({ sessionID: compatible.id, text: "Route compatible Auto" }))
        yield* Effect.promise(() =>
          client.session.wait({ sessionID: compatible.id }, { signal: AbortSignal.timeout(10000) }),
        )
        const compatibleAssistant = (yield* Effect.promise(() =>
          client.message.list({ sessionID: compatible.id }),
        )).data.find((message) => message.type === "assistant")
        assert.equal(compatibleAssistant?.type, "assistant")
        // The native compatible route retains raw usage metadata alongside the routed model,
        // matching the native OpenRouter Auto shape rather than the retired AISDK extractor's
        // smaller routedModelID-only object.
        assert.deepEqual(
          compatibleAssistant.providerState,
          {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            routedModelID: "provider/compatible-actual",
          },
          JSON.stringify({ compatibleAssistant, requested }),
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
        assert(
          requested.some((item) => item.model === "kilo-auto/compatible" && item.compatibleReasoningEffort === "high"),
          JSON.stringify(requested),
        )
        assert(requested.some((item) => item.model === "ordinary"))
        assert(!requested.some((item) => item.model === "provider/actual"))
        // The server sentinels use the live loopback origin the credential metadata actually
        // carries, both as a raw value and as a serialized `"server"` key, rather than an inert
        // placeholder host no fixture body could contain.
        const sentinels = [
          "metadata-probe",
          "fixture-only",
          gateway.url.origin,
          `"server":${JSON.stringify(gateway.url.origin)}`,
          '"server":',
          "organizationID",
          "organizations",
          "selectedOrganizationId",
          "hasPersonalAccount",
          "email",
        ]
        // Every request family is covered by the session http.request hook sanitizer:
        // 1. Title generation runs through SessionModelRequest.prepare (session/title.ts
        //    context.prepare), whose StreamOptions.http middleware applies the hook.
        // 2. The compatible Auto alias is retired: compatible Auto models resolve to the
        //    Kilo-owned native openai-compatible-routed route, which isolates credential
        //    metadata at the provider-package boundary and transports through the same
        //    hook middleware as every other native route.
        // Assert the positive regression over ALL wire bodies, titles included; a title
        // request must be present so this coverage can never silently lapse.
        const isTitle = (raw: string) => raw.includes("You are a title generator")
        assert(
          requested.some((item) => isTitle(item.raw)),
          "A title request must be measured",
        )
        assert(
          requested.some((item) => item.model === "kilo-auto/free"),
          "Native Auto requests must be measured",
        )
        assert(
          requested.some((item) => item.model === "kilo-auto/compatible"),
          "Compatible Auto requests must be measured",
        )
        for (const leaked of sentinels) {
          const offender = requested.find((item) => item.raw.includes(leaked))
          assert(!offender, `Credential metadata must stay out of request bodies: ${leaked} in ${offender?.raw}`)
        }
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
