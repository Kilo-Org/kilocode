import type { Provider } from "@/provider/provider"

const EFFORTS = ["low", "high", "max"] as const
const MODEL = /(?:^|\/)kimi-k3(?:$|[-/:])/i
const ROUTERS = new Set(["@kilocode/kilo-gateway", "@openrouter/ai-sdk-provider"])
const COMPATIBLE = new Set([
  "@ai-sdk/cerebras",
  "@ai-sdk/deepinfra",
  "@ai-sdk/gateway",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/togetherai",
  "@ai-sdk/xai",
  "ai-gateway-provider",
  "venice-ai-sdk-provider",
])

export function kimiK3Variants(model: Provider.Model) {
  if (![model.id, model.api.id].some((id) => MODEL.test(id))) return
  if (ROUTERS.has(model.api.npm)) {
    return Object.fromEntries(EFFORTS.map((effort) => [effort, { reasoning: { enabled: true, effort } }]))
  }
  if (!COMPATIBLE.has(model.api.npm)) return
  return Object.fromEntries(EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
}
