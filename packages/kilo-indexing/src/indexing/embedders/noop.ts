// kilocode_change - new file
// No-op embedder for zero-config graph indexing.
// Returns zero vectors so the graph database works without any embedding provider.
// Semantic search will return empty results until a real embedder is configured.
// This is similar to how GitNexus works without --embeddings flag.

import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"

export class NoOpEmbedder implements IEmbedder {
  get embedderInfo(): EmbedderInfo {
    return { name: "noop" as any }
  }

  async createEmbeddings(texts: string[]): Promise<EmbeddingResponse> {
    // Return zero vectors — LanceDB will store them but they won't match anything
    const embeddings = texts.map(() => new Array(384).fill(0))
    return {
      embeddings,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }

  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true }
  }
}
