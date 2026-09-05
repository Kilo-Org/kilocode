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

export function normalizeKiloEmbeddingModelId(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  if (!model) return undefined
  return catalog.aliases[model] ?? model
}

export function getKiloEmbeddingModel(model: string | undefined, catalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG) {
  const id = normalizeKiloEmbeddingModelId(model, catalog)
  return catalog.models.find((item) => item.id === id)
}

export function formatKiloEmbeddingModelLabel(model: KiloEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}
