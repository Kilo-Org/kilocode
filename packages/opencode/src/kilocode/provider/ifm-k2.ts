// OpenAI-compatible endpoint support for the MBZUAI-IFM K2 model family
// (K2-Think, K2-Horizon) served at https://api.ifm.ai/v1, see https://docs.ifm.ai.
//
// The endpoint speaks OpenAI chat completions, but reasoning is controlled with
// `chat_template_kwargs: { reasoning_effort }` in the request body (not the
// top-level `reasoning_effort`), and the thinking trace is returned in
// `reasoning_content`. Applying these defaults automatically means an IFM K2
// endpoint needs the same three fields as any other OpenAI-compatible
// provider: model, API key, and base URL.

import type { Provider } from "@/provider/provider"

export const REASONING_FIELD = "reasoning_content"

export const EFFORTS = ["low", "medium", "high"] as const

// Matches the IFM K2 reasoning family by model ID. The segment anchor keeps
// Moonshot's `kimi-k2` IDs ("moonshotai/kimi-k2-thinking") from matching, and
// only the reasoning variants (K2-Think, K2-Horizon) are covered on purpose.
const K2 = /(?:^|\/)k2-(?:think|horizon)(?:[.-]|$)/i

export function isK2(apiID: string) {
  return K2.test(apiID)
}

export function effortVariants() {
  return Object.fromEntries(EFFORTS.map((effort) => [effort, { chat_template_kwargs: { reasoning_effort: effort } }]))
}

// Fills in IFM K2 capability defaults on a parsed model. `cfg` is the raw
// config entry so values the user set explicitly always win; `null` entries
// are transient delete sentinels and count as unset.
export function applyDefaults(model: Provider.Model, cfg?: { reasoning?: boolean | null; interleaved?: unknown }) {
  if (model.api.npm !== "@ai-sdk/openai-compatible" || !isK2(model.api.id)) return
  const unset = (value: unknown) => value === undefined || value === null
  if (unset(cfg?.reasoning) && !model.capabilities.reasoning) model.capabilities.reasoning = true
  if (unset(cfg?.interleaved) && !model.capabilities.interleaved) {
    model.capabilities.interleaved = { field: REASONING_FIELD }
  }
}
