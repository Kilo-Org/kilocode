import {
  FALLBACK_KILO_EMBEDDING_MODEL_CATALOG,
  type KiloEmbeddingModel,
  type KiloEmbeddingModelCatalog,
} from "@kilocode/kilo-gateway"

export type { KiloEmbeddingModel, KiloEmbeddingModelCatalog }

export const FALLBACK_KILO_DEFAULT_EMBEDDING_MODEL = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.defaultModel
export const FALLBACK_KILO_EMBEDDING_MODELS = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.models
export const FALLBACK_KILO_EMBEDDING_MODEL_ALIASES: Record<string, string> = FALLBACK_KILO_EMBEDDING_MODEL_CATALOG.aliases
export { FALLBACK_KILO_EMBEDDING_MODEL_CATALOG }

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
