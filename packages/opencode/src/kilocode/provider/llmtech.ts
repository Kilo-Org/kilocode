// LLM Tech (llmtech.eu) is not listed on models.dev, so its static catalog is
// injected here. The endpoint is OpenAI-compatible and serves a fixed model
// list, so no runtime model discovery is needed.
import type { Provider } from "@opencode-ai/core/models-dev"

export const PROVIDER_ID = "llmtech"

export const DEFAULT_MODEL_ID = "unsloth/Qwen3.8-27B-NVFP4"

export const CatalogProvider = {
  id: PROVIDER_ID,
  name: "LLM Tech",
  description: "Qwen3.8-27B (NVFP4) served from EU hardware. Zero data retention.",
  env: ["LLMTECH_API_KEY"],
  api: "https://api.llmtech.eu/v1",
  npm: "@ai-sdk/openai-compatible",
  models: {
    [DEFAULT_MODEL_ID]: {
      id: DEFAULT_MODEL_ID,
      name: "Qwen3.8 27B (NVFP4)",
      family: "qwen",
      release_date: "",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: { input: 0.38, output: 2.9, cache_read: 0.04 },
      limit: { context: 262144, output: 32768 },
      modalities: { input: ["text"], output: ["text"] },
    },
  },
} satisfies Provider

/** Adds the LLM Tech catalog unless the snapshot already carries one. */
export function overlay(providers: Record<string, Provider>): Record<string, Provider> {
  if (providers[PROVIDER_ID]) return providers
  return { ...providers, [PROVIDER_ID]: CatalogProvider }
}
