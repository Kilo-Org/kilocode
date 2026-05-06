import type { EmbedderProvider } from "./interfaces/manager"
import { getDefaultModelId, getModelDimension } from "./model-registry"

export interface EmbeddingProfile {
  provider: EmbedderProvider
  modelId: string
  dimension: number
}

function parseDimension(value?: number): number | undefined {
  if (value === undefined || value === null) return undefined
  const dim = Number(value)
  if (!Number.isFinite(dim) || dim <= 0) return undefined
  return dim
}

export function resolveEmbeddingProfile(
  provider: EmbedderProvider,
  modelId?: string,
  modelDimension?: number,
): EmbeddingProfile | undefined {
  const id = modelId ?? getDefaultModelId(provider)
  const dim = getModelDimension(provider, id) ?? parseDimension(modelDimension)
  if (!dim) return undefined
  return {
    provider,
    modelId: id,
    dimension: dim,
  }
}

export function isEmbeddingProfileEqual(a?: EmbeddingProfile, b?: EmbeddingProfile): boolean {
  if (!a || !b) return false
  return a.provider === b.provider && a.modelId === b.modelId && a.dimension === b.dimension
}
