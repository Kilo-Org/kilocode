// Portable smoke entrypoint, bundled into the artifact by build-portable.ts as
// portable-smoke.js. It boots the REAL launch() host against a loopback Bun.serve gateway
// and drives the native Auto routes (kilo-auto/free -> OpenRouter-routed and
// kilo-auto/compatible -> OpenAI-compatible-routed), asserting:
//   1. the routed native modules resolve from THIS artifact's node_modules (not a checkout)
//      — the portable seam that fails under single-file --compile;
//   2. routedModelID is read back from terminal provider state on both routes;
//   3. Kilo credential/account metadata never serializes into a Gateway request body;
//   4. every wire body carries provider.data_collection deny (hide_prompt_training_models).
// It is not a fake: it uses the same launch(), gateway plugin, and routed modules the shipped
// host uses. The credential is injected in-process via endpoint.importCredential because the
// public HTTP API intentionally has no credential-import RPC. Loopback only; no network.
import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"
import { isKiloAutoID } from "../src/routed-model"

// [SEAM] Prove the two routed native modules resolve to real files inside THIS artifact.
// In a correctly built portable artifact these are <out>/node_modules/@opencode-ai/ai/...
// file URLs; under single-file --compile import.meta.resolve throws (see packaging doc).
const resolvedRoutes = {
  openrouter: import.meta.resolve("@opencode-ai/ai/kilocode/openrouter-routed"),
  openaiCompatible: import.meta.resolve("@opencode-ai/ai/kilocode/openai-compatible-routed"),
}
assert(
  resolvedRoutes.openrouter.startsWith("file://"),
  `routed OpenRouter must be a real file: ${resolvedRoutes.openrouter}`,
)
assert(
  resolvedRoutes.openaiCompatible.startsWith("file://"),
  `routed OpenAI-compatible must be a real file: ${resolvedRoutes.openaiCompatible}`,
)

const requested: Array<{
  model: string
  reasoningEffort: unknown
  compatibleReasoningEffort: unknown
  dataCollection: unknown
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
            opencode: { ai_sdk_provider: "openai-compatible", variants: { high: { reasoningEffort: "high" } } },
          },
        ],
      })
    if (url.pathname !== "/api/gateway/chat/completions") return new Response(null, { status: 404 })
    assert.equal(request.headers.get("authorization"), "Bearer portable-smoke")
    const text = await request.text()
    const body = JSON.parse(text) as {
      model?: string
      provider?: { data_collection?: unknown }
      reasoning?: { effort?: unknown }
      reasoning_effort?: unknown
    }
    requested.push({
      model: body.model ?? "",
      reasoningEffort: body.reasoning?.effort,
      compatibleReasoningEffort: body.reasoning_effort,
      dataCollection: body.provider?.data_collection,
      raw: text,
    })
    const responseModel = body.model === "kilo-auto/compatible" ? "provider/compatible-actual" : "provider/actual"
    const frames = [
      {
        id: "portable-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model: responseModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "Portable smoke response" }, finish_reason: null }],
      },
      {
        id: "portable-smoke",
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

async function main() {
  const input = layout("interactive")
  await mkdir(path.dirname(input.config), { recursive: true })
  await Bun.write(input.config, '{ "hide_prompt_training_models": true }\n')
  const run = Effect.gen(function* () {
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
    // Hostile credential metadata mirrors device OAuth storage; the gateway asserts its absence.
    yield* Effect.promise(() =>
      endpoint.importCredential({
        kind: "api-key",
        integrationID: "kilo",
        key: "portable-smoke",
        label: "Portable smoke metadata probe",
        metadata: {
          server: gateway.url.origin,
          email: "portable-smoke@example.test",
          name: "Portable Smoke",
          organizations: "portable-smoke-org",
          organizationName: "Portable Smoke Org",
          selectedOrganizationId: "portable-smoke-org",
          hasPersonalAccount: "true",
          user: "portable-smoke-user",
          token: "portable-smoke-token",
          access: "portable-smoke-access",
          refresh: "portable-smoke-refresh",
        },
      }),
    )
    const inventory = yield* Effect.promise(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const models = await client.model.list({ location })
        if (models.data.some((model) => model.providerID === "kilo" && isKiloAutoID(model.id))) return models
        await Bun.sleep(20)
      }
      return client.model.list({ location })
    })
    assert(
      inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"),
      JSON.stringify(inventory),
    )
    assert(
      inventory.data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/compatible"),
      JSON.stringify(inventory),
    )

    // Native OpenRouter Auto route.
    const auto = yield* Effect.promise(() =>
      client.session.create({ location, model: { providerID: "kilo", id: "kilo-auto/free", variant: "high" } }),
    )
    yield* Effect.promise(() => client.session.prompt({ sessionID: auto.id, text: "Route this Auto request" }))
    yield* Effect.promise(() => client.session.wait({ sessionID: auto.id }, { signal: AbortSignal.timeout(15000) }))
    const autoAssistant = (yield* Effect.promise(() => client.message.list({ sessionID: auto.id }))).data.find(
      (message) => message.type === "assistant",
    )
    assert.equal(autoAssistant?.type, "assistant")
    assert.equal(
      (autoAssistant.providerState as { routedModelID?: string } | undefined)?.routedModelID,
      "provider/actual",
      JSON.stringify({ autoAssistant, requested }),
    )

    // Native OpenAI-compatible Auto route.
    const compatible = yield* Effect.promise(() =>
      client.session.create({ location, model: { providerID: "kilo", id: "kilo-auto/compatible", variant: "high" } }),
    )
    yield* Effect.promise(() => client.session.prompt({ sessionID: compatible.id, text: "Route compatible Auto" }))
    yield* Effect.promise(() =>
      client.session.wait({ sessionID: compatible.id }, { signal: AbortSignal.timeout(15000) }),
    )
    const compatibleAssistant = (yield* Effect.promise(() =>
      client.message.list({ sessionID: compatible.id }),
    )).data.find((message) => message.type === "assistant")
    assert.equal(compatibleAssistant?.type, "assistant")
    assert.equal(
      (compatibleAssistant.providerState as { routedModelID?: string } | undefined)?.routedModelID,
      "provider/compatible-actual",
      JSON.stringify({ compatibleAssistant, requested }),
    )

    // Reasoning variants reach the wire per route dialect.
    assert(
      requested.some((item) => item.model === "kilo-auto/free" && item.reasoningEffort === "high"),
      JSON.stringify(requested),
    )
    assert(
      requested.some((item) => item.model === "kilo-auto/compatible" && item.compatibleReasoningEffort === "high"),
      JSON.stringify(requested),
    )

    // Credential/account metadata must never serialize into any Gateway request body.
    const sentinels = [
      "portable-smoke@example.test",
      "portable-smoke-org",
      "portable-smoke-token",
      "portable-smoke-access",
      "portable-smoke-refresh",
      "organizationID",
      "selectedOrganizationId",
      "email",
      `"server":`,
    ]
    for (const leaked of sentinels) {
      const offender = requested.find((item) => item.raw.includes(leaked))
      assert(!offender, `Credential metadata must stay out of request bodies: ${leaked} in ${offender?.raw}`)
    }
    // Every wire body carries provider.data_collection deny.
    for (const item of requested) {
      assert.equal(item.dataCollection, "deny", `Every wire body must request data-collection denial: ${item.raw}`)
    }
    return { requests: requested.length, routes: resolvedRoutes }
  })
  const result = await Effect.runPromise(Effect.scoped(run).pipe(Effect.provide(NodeHttpServer.layerHttpServices)))
  return result
}

try {
  const result = await main()
  console.log(`KILO_PORTABLE_SMOKE_OK ${JSON.stringify(result)}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await gateway.stop(true)
}
