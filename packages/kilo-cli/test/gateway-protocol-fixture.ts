import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

// Deliberately opaque IDs: dispatch must use the catalog tag, never a model-name heuristic.
const protocols = [
  { id: "fixture-a", provider: "anthropic", suffix: "/messages" },
  { id: "fixture-b", provider: "openai", suffix: "/responses" },
  { id: "fixture-c", provider: "openai-compatible", suffix: "/chat/completions" },
  { id: "fixture-d", provider: "openrouter", suffix: "/chat/completions" },
] as const
const requests: Array<{
  path: string
  body: Record<string, unknown>
  authorization: string | null
  apiKey: string | null
  organization: string | null
}> = []
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile")
      return Response.json({
        organizations: [{ id: "team", name: "Fixture team", role: "member" }],
        selectedOrganizationId: "team",
        hasPersonalAccount: true,
      })
    if (url.pathname === "/api/openrouter/models" || url.pathname === "/api/organizations/team/models")
      return Response.json({
        data: protocols.map((item) => ({
          id: item.id,
          name: item.id,
          context_length: 128000,
          supported_parameters: ["tools"],
          opencode: {
            ai_sdk_provider:
              url.pathname === "/api/openrouter/models" && item.id === "fixture-a"
                ? "openai-compatible"
                : item.provider,
          },
        })),
      })
    if (!url.pathname.startsWith("/api/gateway/")) return new Response(null, { status: 404 })
    const body = (await request.json()) as Record<string, unknown>
    requests.push({
      path: url.pathname,
      body,
      authorization: request.headers.get("authorization"),
      apiKey: request.headers.get("x-api-key"),
      organization: request.headers.get("x-kilocode-organizationid"),
    })
    const text = `Protocol reply ${String(body.model)}`
    if (url.pathname.endsWith("/messages"))
      return stream([
        {
          type: "message_start",
          message: {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ])
    if (url.pathname.endsWith("/responses"))
      return stream([
        { type: "response.created", response: { id: "resp_fixture", model: body.model } },
        { type: "response.output_item.added", output_index: 0, item: { id: "rs_fixture", type: "reasoning" } },
        { type: "response.reasoning_summary_part.added", output_index: 0, item_id: "rs_fixture", summary_index: 0 },
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          item_id: "rs_fixture",
          summary_index: 0,
          delta: "Fixture reasoning",
        },
        { type: "response.reasoning_summary_part.done", output_index: 0, item_id: "rs_fixture", summary_index: 0 },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "rs_fixture", type: "reasoning", encrypted_content: "encrypted-fixture" },
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { id: "msg_fixture", type: "message", role: "assistant", content: [] },
        },
        { type: "response.output_text.delta", item_id: "msg_fixture", output_index: 1, content_index: 0, delta: text },
        {
          type: "response.completed",
          response: {
            id: "resp_fixture",
            status: "completed",
            model: body.model,
            output: [
              {
                id: "rs_fixture",
                type: "reasoning",
                encrypted_content: "encrypted-fixture",
                summary: [{ type: "summary_text", text: "Fixture reasoning" }],
              },
              {
                id: "msg_fixture",
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text, annotations: [] }],
              },
            ],
            usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
          },
        },
      ])
    if (!body.stream)
      return Response.json({
        id: "chat_fixture",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      })
    return stream([
      {
        id: "chat_fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
      },
      {
        id: "chat_fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
    ])
  },
})

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(layout("interactive"), {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin },
          content: JSON.stringify({
            model: "kilo/fixture-c",
            providers: {
              kilo: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { "fixture-a": { name: "Configured fixture A", limit: { context: 96000 } } },
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
        // Regression probe: credential metadata must never leak into any protocol's request body.
        // The hostile fields mirror what device OAuth stores (profile, server, organizationID) plus
        // token material; every dialect is asserted clean below. Sessions here are pre-titled, so
        // every request flows through the session http.request hook path.
        yield* Effect.promise(() =>
          endpoint.importCredential({
            kind: "api-key",
            integrationID: "kilo",
            key: "fixture-only",
            label: "Fixture metadata probe",
            metadata: {
              server: gateway.url.origin,
              organizationID: "team",
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
        yield* Effect.promise(async () => {
          for (let i = 0; i < 100; i++) {
            if ((await client.model.list({ location })).data.some((item) => item.id === "fixture-c")) return
            await Bun.sleep(20)
          }
          throw new Error("Gateway catalog did not activate")
        })
        const catalog = (yield* Effect.promise(() => client.model.list({ location }))).data
        const configured = catalog.find((item) => item.providerID === "kilo" && item.id === "fixture-a")
        assert.equal(configured?.name, "Configured fixture A")
        assert.equal(configured?.limit.context, 96000)
        assert.equal(
          catalog.find((item) => item.providerID === "kilo" && item.id === "fixture-c")?.limit.context,
          128000,
        )
        for (const protocol of protocols) {
          const session = yield* Effect.promise(() =>
            client.session.create({
              location,
              title: "Protocol fixture",
              model: { providerID: "kilo", id: protocol.id },
            }),
          )
          for (const text of ["First fixture request", "Continue with the previous answer"]) {
            yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text }))
            yield* Effect.promise(() =>
              client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) }),
            )
          }
          const messages = (yield* Effect.promise(() => client.message.list({ sessionID: session.id, order: "asc" })))
            .data
          const assistants = messages.filter((item) => item.type === "assistant")
          assert.equal(assistants.length, 2, JSON.stringify(messages))
          assert(
            assistants.every((item) =>
              item.content.some((part) => part.type === "text" && part.text.includes(`Protocol reply ${protocol.id}`)),
            ),
            JSON.stringify(assistants),
          )
          const sent = requests.filter((item) => item.body.model === protocol.id)
          assert.equal(sent.length, 2, JSON.stringify(sent))
          assert(
            sent.every((item) => item.path === `/api/gateway${protocol.suffix}`),
            JSON.stringify(sent),
          )
          assert(
            sent.every((item) => item.authorization === "Bearer fixture-only"),
            "All Kilo protocols require the Gateway bearer, including Anthropic key auth",
          )
          assert(
            sent.every((item) => item.organization === "team"),
            "Protocol changes must preserve selected-team routing",
          )
          assert(
            JSON.stringify(sent[1].body).includes(`Protocol reply ${protocol.id}`),
            "Settled assistant text must be replayed",
          )
          assert(
            !JSON.stringify(sent.map((item) => item.body)).includes("fixture-only"),
            "Credential must stay out of request bodies",
          )
          const wire = JSON.stringify(sent.map((item) => item.body))
          for (const leaked of [
            "metadata-probe",
            "organizationID",
            "organizations",
            "selectedOrganizationId",
            "hasPersonalAccount",
            '"email"',
            '"server"',
            '"token"',
            '"access"',
            '"refresh"',
          ]) {
            assert(!wire.includes(leaked), `Credential metadata must stay out of request bodies: ${leaked}`)
          }
          if (protocol.provider === "openai") {
            assert.equal(sent[1].body.store, false)
            assert(Array.isArray(sent[1].body.input))
            assert(!sent[1].body.input.some((item) => item.type === "item_reference"))
            assert(
              !sent[1].body.input.some((item) => "id" in item),
              "Stateless Gateway replay must strip provider item IDs",
            )
            assert(
              sent[1].body.input.some((item) => item.encrypted_content === "encrypted-fixture"),
              "Stateless replay must preserve encrypted reasoning",
            )
          }
        }
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: null }, { location }))
        const personal = yield* Effect.promise(() =>
          client.session.create({
            location,
            title: "Personal fixture",
            model: { providerID: "kilo", id: "fixture-a" },
          }),
        )
        yield* Effect.promise(() =>
          client.session.prompt({ sessionID: personal.id, text: "Use the current personal catalog" }),
        )
        yield* Effect.promise(() =>
          client.session.wait({ sessionID: personal.id }, { signal: AbortSignal.timeout(10000) }),
        )
        const last = requests.findLast((item) => item.body.model === "fixture-a")
        assert.equal(last?.path, "/api/gateway/chat/completions", "Same model ID must adopt the new account's protocol")
        assert.equal(last.organization, null, "Old team header must not survive switching to personal")
        assert.equal(last.authorization, "Bearer fixture-only")
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("GATEWAY_PROTOCOL_OK")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await gateway.stop(true)
}

function stream(events: readonly unknown[]) {
  return new Response(events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}
