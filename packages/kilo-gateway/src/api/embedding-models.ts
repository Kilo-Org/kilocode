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
      return EMPTY_KILO_EMBEDDING_MODEL_CATALOG
    }
    const parsed = catalog.safeParse(await response.json())
    if (!parsed.success) {
      console.warn("[Kilo Gateway] Embedding model catalog response validation failed:", parsed.error.format())
      return EMPTY_KILO_EMBEDDING_MODEL_CATALOG
    }
    return parsed.data
  } catch (err) {
    console.warn("[Kilo Gateway] Error fetching embedding model catalog:", err)
    return EMPTY_KILO_EMBEDDING_MODEL_CATALOG
  }
}
