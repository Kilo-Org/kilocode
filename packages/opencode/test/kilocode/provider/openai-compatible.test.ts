import { afterEach, expect, test } from "bun:test"
import { streamText, type ModelMessage } from "ai"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { patchOpenAICompatibleOptions } from "@/kilocode/provider/provider"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { disposeAllInstances, provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { testProviderConfig } from "../../lib/test-provider"

afterEach(async () => {
  await disposeAllInstances()
})

const models = Layer.succeed(
  ModelsDev.Service,
  ModelsDev.Service.of({ get: () => Effect.succeed({}), refresh: () => Effect.void }),
)

const layer = Provider.layer.pipe(
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Plugin.defaultLayer.pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))),
  Layer.provide(models),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const it = testEffect(Layer.mergeAll(layer, CrossSpawnSpawner.defaultLayer))

test("preserves an existing request transform and unrelated messages", () => {
  const options: Record<string, unknown> = {
    transformRequestBody: (body: Record<string, unknown>) => ({ ...body, marker: true }),
  }
  patchOpenAICompatibleOptions("@ai-sdk/openai-compatible", options)
  const transform = options.transformRequestBody
  if (typeof transform !== "function") throw new Error("Expected request transform")
  const body: unknown = transform({
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1" }] },
      { role: "assistant", content: null },
      { role: "tool", content: "result", tool_call_id: "call_1" },
    ],
  })
  expect(body).toEqual({
    marker: true,
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
      { role: "assistant", content: null },
      { role: "tool", content: "result", tool_call_id: "call_1" },
    ],
  })
})

it.live(
  "normalizes null tool-call content on the standard provider path",
  () =>
    Effect.gen(function* () {
      const requests: Array<{ path: string; body: Record<string, unknown> }> = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            async fetch(request) {
              const body = await request.json()
              if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected request body")
              requests.push({ path: new URL(request.url).pathname, body })
              return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
                headers: { "content-type": "text/event-stream" },
              })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const port = server.port
      if (port === undefined) throw new Error("Server did not bind to a port")

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
            const messages: ModelMessage[] = [
              { role: "user", content: "List files" },
              {
                role: "assistant",
                content: [{ type: "tool-call", toolCallId: "call_1", toolName: "list_files", input: {} }],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "call_1",
                    toolName: "list_files",
                    output: { type: "text", value: "a.ts" },
                  },
                ],
              },
            ]
            const result = streamText({ model: yield* provider.getLanguage(model), messages })
            expect(yield* Effect.promise(() => result.text)).toBe("ok")
          }),
        { config: testProviderConfig(`http://127.0.0.1:${port}/v1`) },
      )

      expect(requests).toHaveLength(1)
      expect(requests[0]?.path).toBe("/v1/chat/completions")
      expect(requests[0]?.body).toMatchObject({ model: "test-model", stream: true })
      const messages = requests[0]?.body.messages
      expect(Array.isArray(messages)).toBe(true)
      if (!Array.isArray(messages)) throw new Error("Expected messages array")
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } }],
      })
      expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "a.ts" })
    }),
  { timeout: 10_000 },
)
