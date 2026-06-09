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

export const EMPTY_KILO_EMBEDDING_MODEL_CATALOG: KiloEmbeddingModelCatalog = {
  defaultModel: "",
  models: [],
  aliases: {},
}

export const BUNDLED_KILO_EMBEDDING_MODEL_CATALOG: KiloEmbeddingModelCatalog = {
  defaultModel: "mistralai/mistral-embed-2312",
  models: [
    {
      id: "mistralai/codestral-embed-2505",
      name: "Codestral Embed 2505",
      dimension: 1536,
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
    { id: "qwen/qwen3-embedding-8b", name: "Qwen3 Embedding 8B", dimension: 4096, scoreThreshold: 0.35 },
    { id: "qwen/qwen3-embedding-4b", name: "Qwen3 Embedding 4B", dimension: 2560, scoreThreshold: 0.35 },
    { id: "perplexity/pplx-embed-v1-4b", name: "Perplexity Embed V1 4B", dimension: 2560, scoreThreshold: 0.35 },
    { id: "perplexity/pplx-embed-v1-0.6b", name: "Perplexity Embed V1 0.6B", dimension: 1024, scoreThreshold: 0.35 },
    { id: "baai/bge-m3", name: "BAAI bge-m3", dimension: 1024, scoreThreshold: 0.35 },
    { id: "baai/bge-large-en-v1.5", name: "BAAI bge-large-en-v1.5", dimension: 1024, scoreThreshold: 0.35 },
    { id: "baai/bge-base-en-v1.5", name: "BAAI bge-base-en-v1.5", dimension: 768, scoreThreshold: 0.35 },
    { id: "thenlper/gte-large", name: "GTE Large", dimension: 1024, scoreThreshold: 0.35 },
    { id: "thenlper/gte-base", name: "GTE Base", dimension: 768, scoreThreshold: 0.35 },
    { id: "intfloat/e5-large-v2", name: "E5 Large v2", dimension: 1024, scoreThreshold: 0.35 },
    { id: "intfloat/e5-base-v2", name: "E5 Base v2", dimension: 768, scoreThreshold: 0.35 },
    { id: "intfloat/multilingual-e5-large", name: "Multilingual E5 Large", dimension: 1024, scoreThreshold: 0.35 },
    { id: "sentence-transformers/all-mpnet-base-v2", name: "all-mpnet-base-v2", dimension: 768, scoreThreshold: 0.35 },
    { id: "sentence-transformers/all-minilm-l12-v2", name: "all-MiniLM-L12-v2", dimension: 384, scoreThreshold: 0.35 },
    { id: "sentence-transformers/all-minilm-l6-v2", name: "all-MiniLM-L6-v2", dimension: 384, scoreThreshold: 0.35 },
    {
      id: "sentence-transformers/paraphrase-minilm-l6-v2",
      name: "paraphrase-MiniLM-L6-v2",
      dimension: 384,
      scoreThreshold: 0.35,
    },
    {
      id: "sentence-transformers/multi-qa-mpnet-base-dot-v1",
      name: "multi-qa-mpnet-base-dot-v1",
      dimension: 768,
      scoreThreshold: 0.35,
    },
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
    const response = await fetch(url, { signal: options.signal, redirect: "error" })
    if (!response.ok) {
      console.warn(`[Kilo Gateway] Failed to fetch embedding model catalog: ${response.status}`)
      return BUNDLED_KILO_EMBEDDING_MODEL_CATALOG
    }
    const parsed = catalog.safeParse(await response.json())
    if (!parsed.success) {
      console.warn("[Kilo Gateway] Embedding model catalog response validation failed:", parsed.error.format())
      return BUNDLED_KILO_EMBEDDING_MODEL_CATALOG
    }
    return parsed.data
  } catch (err) {
    console.warn("[Kilo Gateway] Error fetching embedding model catalog:", err)
    return BUNDLED_KILO_EMBEDDING_MODEL_CATALOG
  }
}
