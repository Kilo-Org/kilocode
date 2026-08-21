import type { AnthropicProviderOptions } from "@ai-sdk/anthropic"
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai"
import type { OpenAICompatibleProviderOptions } from "@ai-sdk/openai-compatible"
import type { OpenRouterProviderOptions } from "@openrouter/ai-sdk-provider"

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
  return result
}
