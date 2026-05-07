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

export const FALLBACK_KILO_DEFAULT_EMBEDDING_MODEL = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.defaultModel
export const FALLBACK_KILO_EMBEDDING_MODELS = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.models
export const FALLBACK_KILO_EMBEDDING_MODEL_ALIASES: Record<string, string> = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.aliases

export function normalizeKiloEmbeddingModelId(model: string | undefined, catalog = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG) {
  if (!model) return undefined
  return catalog.aliases[model] ?? model
}

export function getKiloEmbeddingModel(model: string | undefined, catalog = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG) {
  const id = normalizeKiloEmbeddingModelId(model, catalog)
  return catalog.models.find((item) => item.id === id)
}

export function formatKiloEmbeddingModelLabel(model: KiloEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}
