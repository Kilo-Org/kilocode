import path from "path"
import type { VectorStoreSearchResult } from "./interfaces"
import type { IEmbedder } from "./interfaces/embedder"
import type { IVectorStore } from "./interfaces/vector-store"
import type { CodeIndexConfigManager } from "./config-manager"
import type { CodeIndexStateManager } from "./state-manager"
import { Log } from "../util/log"
import type { WorktreeOverlay } from "./worktree-overlay"

interface BaselineSearch {
  store: IVectorStore
  overlay: WorktreeOverlay
}

const log = Log.create({ service: "indexing-search" })

export class CodeIndexSearchService {
  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly stateManager: CodeIndexStateManager,
    private readonly embedder: IEmbedder,
    private readonly vectorStore: IVectorStore,
    private readonly baseline?: BaselineSearch,
  ) {}

  public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
      throw new Error("Code index feature is disabled or not configured.")
    }

    const minScore = this.configManager.currentSearchMinScore
    const maxResults = this.configManager.currentSearchMaxResults

    const currentState = this.stateManager.getCurrentStatus().systemStatus
    if (currentState !== "Indexed" && currentState !== "Indexing") {
      throw new Error(`Code index is not ready for search. Current state: ${currentState}`)
    }

    try {
      const embeddingResponse = await this.embedder.createEmbeddings([query])
      const vector = embeddingResponse?.embeddings[0]
      if (!vector) {
        throw new Error("Failed to generate embedding for query.")
      }

      const normalizedPrefix = directoryPrefix ? path.normalize(directoryPrefix) : undefined
      if (!this.baseline) return await this.vectorStore.search(vector, normalizedPrefix, minScore, maxResults)
      if (!this.baseline.overlay.ready) throw new Error("Worktree index reconciliation is not complete.")

      const ceiling = Math.max(maxResults, Math.min(maxResults * 16, 1000))
      const delta = (async () => {
        const search = async (limit: number): Promise<VectorStoreSearchResult[]> => {
          const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, limit)
          const filtered = results.filter((result) => this.baseline!.overlay.deltaResult(result))
          if (filtered.length >= maxResults || results.length < limit || limit >= ceiling) return filtered
          return search(Math.min(limit * 2, ceiling))
        }
        return search(maxResults)
      })()
      const base = (async () => {
        const checks = new Map<string, Promise<boolean>>()
        const search = async (limit: number): Promise<VectorStoreSearchResult[]> => {
          const results = await this.baseline!.store.search(vector, normalizedPrefix, minScore, limit)
          const accepted = await Promise.all(
            results.map((result) => this.baseline!.overlay.baselineResult(result, checks)),
          )
          const filtered = results.filter((_, index) => accepted[index])
          if (filtered.length >= maxResults || results.length < limit || limit >= ceiling) return filtered
          return search(Math.min(limit * 2, ceiling))
        }
        return search(maxResults)
      })()
      const [baseline, current] = await Promise.all([base, delta])
      const merged = new Map<string, VectorStoreSearchResult>()
      const key = (result: VectorStoreSearchResult) =>
        [result.payload?.filePath, result.payload?.startLine, result.payload?.endLine, result.payload?.codeChunk].join(
          "\0",
        )

      for (const result of baseline) merged.set(key(result), result)
      for (const result of current) {
        if (this.baseline.overlay.deltaResult(result)) merged.set(key(result), result)
      }
      return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, maxResults)
    } catch (err) {
      log.error("search failed", { err })
      throw err
    }
  }
}
