export type KiloEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export const KILO_DEFAULT_EMBEDDING_MODEL = "mistralai/codestral-embed-2505"

export const KILO_EMBEDDING_MODELS = [
  { id: KILO_DEFAULT_EMBEDDING_MODEL, name: "Codestral Embed 2505", dimension: 1536, scoreThreshold: 0.35, note: "code" },
  { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
  { id: "openai/text-embedding-3-small", name: "OpenAI Text Embedding 3 Small", dimension: 1536, scoreThreshold: 0.4 },
  { id: "openai/text-embedding-3-large", name: "OpenAI Text Embedding 3 Large", dimension: 3072, scoreThreshold: 0.4 },
  { id: "openai/text-embedding-ada-002", name: "OpenAI Text Embedding Ada 002", dimension: 1536, scoreThreshold: 0.4 },
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
  { id: "sentence-transformers/paraphrase-minilm-l6-v2", name: "paraphrase-MiniLM-L6-v2", dimension: 384, scoreThreshold: 0.35 },
  { id: "sentence-transformers/multi-qa-mpnet-base-dot-v1", name: "multi-qa-mpnet-base-dot-v1", dimension: 768, scoreThreshold: 0.35 },
] as const satisfies readonly KiloEmbeddingModel[]

export const KILO_EMBEDDING_MODEL_ALIASES: Record<string, string> = {
  "text-embedding-3-small": "openai/text-embedding-3-small",
  "text-embedding-3-large": "openai/text-embedding-3-large",
  "text-embedding-ada-002": "openai/text-embedding-ada-002",
  "codestral-embed-2505": KILO_DEFAULT_EMBEDDING_MODEL,
  "mistral-embed-2312": "mistralai/mistral-embed-2312",
}

export function normalizeKiloEmbeddingModelId(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined
  return KILO_EMBEDDING_MODEL_ALIASES[modelId] ?? modelId
}

export function getKiloEmbeddingModel(modelId: string | undefined): KiloEmbeddingModel | undefined {
  const id = normalizeKiloEmbeddingModelId(modelId)
  return KILO_EMBEDDING_MODELS.find((model) => model.id === id)
}

export function formatKiloEmbeddingModelLabel(model: KiloEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}
