import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { LLMGatewayPlugin } from "@opencode-ai/core/plugin/provider/llmgateway"
import { NvidiaPlugin } from "@opencode-ai/core/plugin/provider/nvidia"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { ZenmuxPlugin } from "@opencode-ai/core/plugin/provider/zenmux"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

// A custom provider that merely points at an official endpoint must not inherit that
// provider's attribution headers, and its models must stay enabled.
const providers: readonly { id: string; api: ProviderV2.Api }[] = [
  {
    id: "custom-llmgateway",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
  },
  {
    id: "custom-nvidia",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://integrate.api.nvidia.com/v1" },
  },
  { id: "custom-openrouter", api: { type: "aisdk", package: "@openrouter/ai-sdk-provider" } },
  { id: "custom-vercel", api: { type: "aisdk", package: "@ai-sdk/vercel" } },
  {
    id: "custom-zenmux",
    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
  },
]

const models = ["gpt-5-chat-latest", "openai/gpt-5-chat"]

const addPlugins = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const integration = yield* Integration.Service
  yield* LLMGatewayPlugin.effect(host).pipe(Effect.provideService(Integration.Service, integration))
  for (const item of [NvidiaPlugin, OpenRouterPlugin, VercelPlugin, ZenmuxPlugin]) {
    yield* item.effect(host)
  }
})

describe("provider attribution isolation", () => {
  it.effect("leaves custom providers with official endpoints untouched", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        for (const item of providers) {
          draft.provider.update(ProviderV2.ID.make(item.id), (entry) => {
            entry.api = item.api
            entry.request.headers.Existing = "value"
          })
        }
        for (const id of models) {
          draft.model.update(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make(id), () => {})
        }
      })
      yield* addPlugins()

      for (const item of providers) {
        expect((yield* catalog.provider.get(ProviderV2.ID.make(item.id)))?.request.headers).toEqual({
          Existing: "value",
        })
      }
      for (const id of models) {
        expect((yield* catalog.model.get(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make(id)))?.enabled).toBe(
          true,
        )
      }
    }),
  )
})
