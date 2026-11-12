import { HEADER_FEATURE, HEADER_ORGANIZATIONID, resolveKiloGatewayBaseUrl } from "../../gateway"
import { MAX_ITEM_TOKENS } from "../constants"
import type { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces/embedder"
import { EMBEDDING_MODEL_UNAVAILABLE } from "../shared/validation-helpers"
import { Log } from "../../util/log"
import { OpenAICompatibleEmbedder } from "./openai-compatible"

const log = Log.create({ service: "embedder-kilo" })

export const KILO_INDEXING_FEATURE = "managed-indexing"

export class KiloEmbedder implements IEmbedder {
  private readonly embedder: OpenAICompatibleEmbedder
  private readonly model: string

  constructor(input: {
    apiKey: string
    baseUrl?: string
    organizationId?: string
    modelId?: string
    dimensions?: number
  }) {
    if (!input.apiKey) throw new Error("Kilo API key is required for embedding.")

    if (!input.modelId) throw new Error("Kilo embedding model is required.")
    this.model = input.modelId
    const headers: Record<string, string> = {
      [HEADER_FEATURE]: KILO_INDEXING_FEATURE,
      ...(input.organizationId ? { [HEADER_ORGANIZATIONID]: input.organizationId } : {}),
    }

    this.embedder = new OpenAICompatibleEmbedder(
      resolveKiloGatewayBaseUrl({ baseURL: input.baseUrl, token: input.apiKey }),
      input.apiKey,
      this.model,
      MAX_ITEM_TOKENS,
      { headers, dimensions: input.dimensions, embedderType: "kilo" },
    )
  }

  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    try {
      return await this.embedder.createEmbeddings(texts, model || this.model)
    } catch (err) {
      log.error("Kilo embedder error", {
        err: err instanceof Error ? err.message : String(err),
        location: "KiloEmbedder:createEmbeddings",
      })
      throw err
    }
  }

  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    try {
      return await this.embedder.validateConfiguration()
    } catch (err) {
      log.error("Kilo embedder validation error", {
        err: err instanceof Error ? err.message : String(err),
        location: "KiloEmbedder:validateConfiguration",
      })
      throw err
    }
  }

  get embedderInfo(): EmbedderInfo {
    return { name: "kilo" }
  }
}

/** The result of checking whether the Gateway actually serves a catalog model. */
export type KiloEmbeddingModelProbe = {
  valid: boolean
  /** The route answered, but not with an embedding for this model: another catalog model may work. */
  modelUnavailable: boolean
  error?: string
}

/** Check one catalog model against the Gateway, so a stale catalog default can be replaced before the engine starts. */
export async function probeKiloEmbeddingModel(input: {
  apiKey: string
  baseUrl?: string
  organizationId?: string
  modelId: string
  dimensions?: number
}): Promise<KiloEmbeddingModelProbe> {
  const result = await new KiloEmbedder(input)
    .validateConfiguration()
    .catch((err) => ({ valid: false, error: err instanceof Error ? err.message : String(err) }))
  return { ...result, modelUnavailable: result.error === EMBEDDING_MODEL_UNAVAILABLE }
}
