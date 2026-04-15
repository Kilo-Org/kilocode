import { Env } from "@/env"
import type { ModelsDev } from "@/provider/models"

export const HPC_AI_ID = "hpc-ai"
export const HPC_AI_NAME = "HPC-AI"
export const HPC_AI_BASE = "https://api.hpc-ai.com/inference/v1"
export const HPC_AI_ENV = "HPC_AI_API_KEY"
export const HPC_AI_BASE_ENV = "HPC_AI_BASE_URL"
export const HPC_AI_MODELS = ["minimax/minimax-m2.5", "moonshotai/kimi-k2.5", "zai-org/glm-5.1"] as const

type HpcModel = ModelsDev.Model & Record<string, unknown>

const fallback = {
  "minimax/minimax-m2.5": {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    family: "minimax",
    attachment: false,
    reasoning: true,
    tool_call: true,
    structured_output: true,
    temperature: true,
    release_date: "2026-02-12",
    last_updated: "2026-02-12",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    cost: { input: 0.3, output: 1.2 },
    limit: { context: 204800, input: 204800, output: 131072 },
  },
  "moonshotai/kimi-k2.5": {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    family: "kimi",
    attachment: true,
    reasoning: false,
    tool_call: true,
    structured_output: false,
    temperature: false,
    release_date: "2026-01-26",
    last_updated: "2026-01-26",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: false,
    cost: { input: 0.3, output: 1.9 },
    limit: { context: 256000, input: 256000, output: 65536 },
  },
  "zai-org/glm-5.1": {
    id: "zai-org/glm-5.1",
    name: "GLM 5.1",
    family: "glm",
    attachment: false,
    reasoning: true,
    tool_call: true,
    structured_output: true,
    temperature: true,
    release_date: "2026-03-27",
    last_updated: "2026-03-27",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: true,
    cost: { input: 0.3, output: 2.55 },
    limit: { context: 200000, input: 200000, output: 131072 },
  },
} satisfies Record<(typeof HPC_AI_MODELS)[number], HpcModel>

function clone(model: ModelsDev.Model, id: (typeof HPC_AI_MODELS)[number]): ModelsDev.Model {
  const result = structuredClone(model)
  result.temperature = result.temperature ?? fallback[id].temperature
  delete result.provider
  return result
}

function find(providers: Record<string, ModelsDev.Provider>, id: (typeof HPC_AI_MODELS)[number]) {
  for (const provider of Object.values(providers)) {
    const model = provider.models[id]
    if (model) return clone(model, id)
  }
  return clone(fallback[id], id)
}

export function injectHpcAiProvider(providers: Record<string, ModelsDev.Provider>) {
  const current = providers[HPC_AI_ID]
  const env = [...new Set([...(current?.env ?? []), HPC_AI_ENV])]
  const models = { ...(current?.models ?? {}) }

  for (const id of HPC_AI_MODELS) {
    models[id] = models[id] ? clone(models[id], id) : find(providers, id)
  }

  providers[HPC_AI_ID] = {
    id: HPC_AI_ID,
    name: current?.name ?? HPC_AI_NAME,
    env,
    api: current?.api ?? HPC_AI_BASE,
    npm: current?.npm ?? "@ai-sdk/openai-compatible",
    models,
  }
}

export function hpcAiOptions() {
  const url = Env.get(HPC_AI_BASE_ENV)
  return url ? { baseURL: url } : {}
}
