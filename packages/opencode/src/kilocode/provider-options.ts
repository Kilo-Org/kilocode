import type { AlibabaProviderOptions } from "@ai-sdk/alibaba"
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic"
import type { MistralLanguageModelOptions } from "@ai-sdk/mistral"
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai"
import type { OpenAICompatibleProviderOptions } from "@ai-sdk/openai-compatible"
import type { OpenRouterProviderOptions } from "@openrouter/ai-sdk-provider"
import { isRecord } from "@/util/record"

type RoutingModel = {
  api: { npm: string }
  ai_sdk_provider?: string
}

function openrouter(model: RoutingModel) {
  if (model.api.npm === "@openrouter/ai-sdk-provider") return true
  if (model.api.npm !== "@kilocode/kilo-gateway") return false
  return model.ai_sdk_provider === undefined || model.ai_sdk_provider === "openrouter"
}

export function enforceOpenRouterDataCollection(input: {
  model: RoutingModel
  body: BodyInit | null | undefined
  method?: string
  deny: boolean
}) {
  if (!input.deny || input.method !== "POST" || !openrouter(input.model) || typeof input.body !== "string") {
    return input.body
  }

  try {
    const body: unknown = JSON.parse(input.body)
    if (!isRecord(body)) return input.body
    const provider = isRecord(body.provider) ? body.provider : {}
    return JSON.stringify({
      ...body,
      provider: {
        ...provider,
        data_collection: "deny",
      },
    })
  } catch {
    return input.body
  }
}

export function kiloProviderOptions(options: { [x: string]: any }) {
  const result: Record<string, any> = {}
  const openrouter = options as OpenRouterProviderOptions & {
    verbosity?: "high" | "medium" | "low"
  }
  result.openrouter = openrouter
  result.openai = {
    reasoningEffort:
      openrouter.reasoning && "effort" in openrouter.reasoning ? openrouter.reasoning?.effort : undefined,
    textVerbosity: openrouter.verbosity,
    store: false,
    forceReasoning: openrouter.reasoning?.enabled,
  } satisfies OpenAIResponsesProviderOptions
  result.anthropic = {
    thinking: { type: openrouter.reasoning?.enabled ? "adaptive" : "disabled" },
    effort: openrouter.verbosity,
  } satisfies AnthropicProviderOptions
  result.openaiCompatible = {
    reasoningEffort:
      openrouter.reasoning && "effort" in openrouter.reasoning ? openrouter.reasoning?.effort : undefined,
    textVerbosity: openrouter.verbosity,
  } satisfies OpenAICompatibleProviderOptions
  result.alibaba = {
    enableThinking: openrouter.reasoning?.enabled,
  } satisfies AlibabaProviderOptions
  result.mistral = {
    reasoningEffort: openrouter.reasoning?.enabled ? "high" : undefined,
  } satisfies MistralLanguageModelOptions
  return result
}
