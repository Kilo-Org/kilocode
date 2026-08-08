import { discoverEmbeddingModels, probeEmbeddingModel } from "../indexing/embedding-models"

type Context = {
  post: (message: unknown) => void
}

export async function handleIndexingModels(msg: Record<string, unknown>, ctx: Context) {
  const rid = typeof msg.requestId === "string" ? msg.requestId : ""
  const baseURL = typeof msg.baseURL === "string" ? msg.baseURL : ""
  const runtime = msg.runtime === "ollama" ? "ollama" : "openai-compatible"
  const apiKey = typeof msg.apiKey === "string" ? msg.apiKey : undefined
  const model = typeof msg.model === "string" ? msg.model : undefined
  if (!rid || !baseURL) return
  try {
    if (model) {
      const result = await probeEmbeddingModel({ runtime, baseURL, apiKey, model })
      ctx.post({ type: "indexingModelsFetched", requestId: rid, model: result })
      return
    }
    const models = await discoverEmbeddingModels({ runtime, baseURL, apiKey })
    ctx.post({ type: "indexingModelsFetched", requestId: rid, models })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Failed to discover embedding models"
    ctx.post({ type: "indexingModelsFetched", requestId: rid, error })
  }
}
