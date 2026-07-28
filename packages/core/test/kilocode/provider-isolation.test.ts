import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { LLMGatewayPlugin } from "@opencode-ai/core/plugin/provider/llmgateway"
import { NvidiaPlugin } from "@opencode-ai/core/plugin/provider/nvidia"
import { OpenRouterPlugin } from "@opencode-ai/core/plugin/provider/openrouter"
import { VercelPlugin } from "@opencode-ai/core/plugin/provider/vercel"
import { ZenmuxPlugin } from "@opencode-ai/core/plugin/provider/zenmux"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, model, provider } from "../plugin/provider-helper"

describe("provider attribution isolation", () => {
  it.effect("leaves custom providers with official endpoints untouched", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      yield* plugins.add({
        ...LLMGatewayPlugin,
        effect: LLMGatewayPlugin.effect.pipe(Effect.provideService(Integration.Service, integrations)),
      })
      for (const plugin of [NvidiaPlugin, OpenRouterPlugin, VercelPlugin, ZenmuxPlugin]) {
        yield* plugins.add(plugin)
      }

      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        const items = [
          provider("custom-llmgateway", {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.llmgateway.io/v1" },
          }),
          provider("custom-nvidia", {
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: "https://integrate.api.nvidia.com/v1",
            },
          }),
          provider("custom-openrouter", {
            api: { type: "aisdk", package: "@openrouter/ai-sdk-provider" },
          }),
          provider("custom-vercel", {
            api: { type: "aisdk", package: "@ai-sdk/vercel" },
          }),
          provider("custom-zenmux", {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://zenmux.ai/api/v1" },
          }),
        ]

        for (const item of items) {
          catalog.provider.update(item.id, (draft) => {
            draft.api = item.api
            draft.request.headers.Existing = "value"
          })
        }
        for (const id of ["gpt-5-chat-latest", "openai/gpt-5-chat"]) {
          const item = model("custom-openrouter", id)
          catalog.model.update(item.providerID, item.id, () => {})
        }
      })

      for (const id of ["custom-llmgateway", "custom-nvidia", "custom-openrouter", "custom-vercel", "custom-zenmux"]) {
        expect((yield* catalog.provider.get(ProviderV2.ID.make(id))).request.headers).toEqual({ Existing: "value" })
      }
      for (const id of ["gpt-5-chat-latest", "openai/gpt-5-chat"]) {
        expect((yield* catalog.model.get(ProviderV2.ID.make("custom-openrouter"), ModelV2.ID.make(id))).enabled).toBe(
          true,
        )
      }
    }),
  )
})
