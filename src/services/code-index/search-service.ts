import * as path from "path"
import { VectorStoreSearchResult } from "./interfaces"
import { IEmbedder } from "./interfaces/embedder"
import { IVectorStore } from "./interfaces/vector-store"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { searchCode } from "./KiloOrgCodeIndexer"

/**
 * Service responsible for searching the code index.
 * kilocode_change: Supports both local and Kilo org mode search
 */
export class CodeIndexSearchService {
	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly embedder: IEmbedder | null, // kilocode_change: nullable for Kilo org mode
		private readonly vectorStore: IVectorStore | null, // kilocode_change: nullable for Kilo org mode
	) {}

	/**
	 * Searches the code index for relevant content.
	 * kilocode_change: Uses Kilo org search when in Kilo org mode
	 * @param query The search query
	 * @param limit Maximum number of results to return
	 * @param directoryPrefix Optional directory path to filter results by
	 * @returns Array of search results
	 * @throws Error if the service is not properly configured or ready
	 */
	public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
			throw new Error("Code index feature is disabled or not configured.")
		}

		const currentState = this.stateManager.getCurrentStatus().systemStatus
		if (currentState !== "Indexed" && currentState !== "Indexing") {
			// Allow search during Indexing too
			throw new Error(`Code index is not ready for search. Current state: ${currentState}`)
		}

		try {
			// kilocode_change start: Use Kilo org search if in Kilo org mode
			const kiloOrgProps = this.configManager.getKiloOrgProps()

			if (kiloOrgProps) {
				console.log(`[CodeIndexSearchService] Using Kilo org search`)
				const results = await searchCode({
					kilocodeToken: kiloOrgProps.kilocodeToken,
					organizationId: kiloOrgProps.organizationId,
					projectId: kiloOrgProps.projectId,
					query,
					path: directoryPrefix,
				})

				// Convert Kilo org results to VectorStoreSearchResult format
				return results.map((result) => ({
					id: result.id,
					score: result.score,
					payload: {
						filePath: result.filePath,
						codeChunk: result.codeChunk,
						startLine: result.startLine,
						endLine: result.endLine,
					},
				}))
			}
			// kilocode_change end

			// Local search mode
			console.log(`[CodeIndexSearchService] Using local vector search`)

			// kilocode_change start: Ensure embedder and vectorStore exist for local mode
			if (!this.embedder || !this.vectorStore) {
				throw new Error("Local search requires embedder and vector store to be configured")
			}
			// kilocode_change end

			const minScore = this.configManager.currentSearchMinScore
			const maxResults = this.configManager.currentSearchMaxResults

			// Generate embedding for query
			const embeddingResponse = await this.embedder.createEmbeddings([query])
			const vector = embeddingResponse?.embeddings[0]
			if (!vector) {
				throw new Error("Failed to generate embedding for query.")
			}

			// Handle directory prefix
			let normalizedPrefix: string | undefined = undefined
			if (directoryPrefix) {
				normalizedPrefix = path.normalize(directoryPrefix)
			}

			// Perform search
			const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, maxResults)
			return results
		} catch (error) {
			console.error("[CodeIndexSearchService] Error during search:", error)
			this.stateManager.setSystemState("Error", `Search failed: ${(error as Error).message}`)

			// Capture telemetry for the error
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: (error as Error).message,
				stack: (error as Error).stack,
				location: "searchIndex",
			})

			throw error // Re-throw the error after setting state
		}
	}
}
