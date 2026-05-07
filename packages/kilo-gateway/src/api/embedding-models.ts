import { z } from "zod"
import { resolveKiloGatewayBaseUrl } from "./url.js"

export type KiloEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export type KiloEmbeddingModelCatalog = {
  defaultModel: string
  models: KiloEmbeddingModel[]
  aliases: Record<string, string>
}

export const FALLBACK_KILO_EMBEDDING_MODEL_CATALOG: KiloEmbeddingModelCatalog = {
  defaultModel: "mistralai/mistral-embed-2312",
  models: [
    {
      id: "mistralai/codestral-embed-2505",
      name: "Codestral Embed 2505",
      dimension: 256,
      scoreThreshold: 0.35,
      note: "code",
    },
    { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
    {
      id: "openai/text-embedding-3-small",
      name: "OpenAI Text Embedding 3 Small",
      dimension: 1536,
      scoreThreshold: 0.4,
    },
    {
      id: "openai/text-embedding-3-large",
      name: "OpenAI Text Embedding 3 Large",
      dimension: 3072,
      scoreThreshold: 0.4,
    },
    {
      id: "openai/text-embedding-ada-002",
      name: "OpenAI Text Embedding Ada 002",
      dimension: 1536,
      scoreThreshold: 0.4,
    },
    { id: "google/gemini-embedding-001", name: "Gemini Embedding 001", dimension: 3072, scoreThreshold: 0.35 },
  ],
  aliases: {
    "text-embedding-3-small": "openai/text-embedding-3-small",
    "text-embedding-3-large": "openai/text-embedding-3-large",
    "text-embedding-ada-002": "openai/text-embedding-ada-002",
    "codestral-embed-2505": "mistralai/codestral-embed-2505",
    "mistral-embed-2312": "mistralai/mistral-embed-2312",
  },
}

const model = z.object({
  id: z.string(),
  name: z.string(),
  dimension: z.number().int().positive(),
  scoreThreshold: z.number(),
  note: z.string().optional(),
})

const catalog = z.object({
  defaultModel: z.string(),
  models: z.array(model),
  aliases: z.record(z.string(), z.string()),
})

type Options = {
  baseURL?: string
  token?: string
  signal?: AbortSignal
}

export async function fetchKiloEmbeddingModelCatalog(options: Options = {}): Promise<KiloEmbeddingModelCatalog> {
  const url = new URL("embedding-models", resolveKiloGatewayBaseUrl({ baseURL: options.baseURL, token: options.token }))

  try {
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) {
      console.warn(`[Kilo Gateway] Failed to fetch embedding model catalog: ${response.status}`)
      return FALLBACK_KILO_EMBEDDING_MODEL_CATALOG
    }
    const parsed = catalog.safeParse(await response.json())
    if (!parsed.success) {
      console.warn("[Kilo Gateway] Embedding model catalog response validation failed:", parsed.error.format())
      return FALLBACK_KILO_EMBEDDING_MODEL_CATALOG
    }
    return parsed.data
  } catch (err) {
    console.warn("[Kilo Gateway] Error fetching embedding model catalog:", err)
    return FALLBACK_KILO_EMBEDDING_MODEL_CATALOG
  }
}
