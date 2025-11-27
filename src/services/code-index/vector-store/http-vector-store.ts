import { IVectorStore, PointStruct } from "../interfaces/vector-store"
import { Payload, VectorStoreSearchResult } from "../interfaces"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"

/**
 * HTTP implementation of the vector store interface that communicates with the backend API
 */
export class HttpVectorStore implements IVectorStore {
	private readonly baseUrl: string
	private readonly workspacePath: string
	private readonly vectorSize: number
	private readonly openRouterApiKey: string

	/**
	 * Creates a new HTTP vector store
	 * @param workspacePath Path to the workspace
	 * @param baseUrl Base URL for the backend API
	 * @param vectorSize Size of the vectors
	 * @param openRouterApiKey API key for authentication
	 */
	constructor(workspacePath: string, baseUrl: string, vectorSize: number, openRouterApiKey: string) {
		this.workspacePath = workspacePath
		this.baseUrl = baseUrl.replace(/\/$/, "") // Remove trailing slash if present
		this.vectorSize = vectorSize
		this.openRouterApiKey = openRouterApiKey
	}

	/**
	 * Initializes the vector store
	 * @returns Promise resolving to boolean indicating if a new collection was created
	 */
	async initialize(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/initialize`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
					vectorSize: this.vectorSize,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const result = await response.json()
			return result.created || false
		} catch (error) {
			console.error("Failed to initialize vector store:", error)
			throw error
		}
	}

	/**
	 * Upserts points into the vector store
	 * @param points Array of points to upsert
	 */
	async upsertPoints(points: PointStruct[]): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/upsert-points`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
					points: points,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			await response.json()
		} catch (error) {
			console.error("Failed to upsert points:", error)
			throw error
		}
	}

	/**
	 * Searches for similar vectors
	 * @param queryVector Vector to search for
	 * @param directoryPrefix Optional directory prefix to filter results
	 * @param minScore Optional minimum score threshold
	 * @param maxResults Optional maximum number of results to return
	 * @returns Promise resolving to search results
	 */
	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/search`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
					queryVector: queryVector,
					directoryPrefix: directoryPrefix,
					minScore: minScore ?? DEFAULT_SEARCH_MIN_SCORE,
					maxResults: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const result = await response.json()
			return result.results || []
		} catch (error) {
			console.error("Failed to search points:", error)
			throw error
		}
	}

	/**
	 * Deletes points by file path
	 * @param filePath Path of the file to delete points for
	 */
	async deletePointsByFilePath(filePath: string): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/delete-points`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
					filePath: filePath,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			await response.json()
		} catch (error) {
			console.error("Failed to delete points by file path:", error)
			throw error
		}
	}

	/**
	 * Deletes points by multiple file paths
	 * @param filePaths Array of file paths to delete points for
	 */
	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			const response = await fetch(`${this.baseUrl}/vector-store/delete-points-batch`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
					filePaths: filePaths,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			await response.json()
		} catch (error) {
			console.error("Failed to delete points by multiple file paths:", error)
			throw error
		}
	}

	/**
	 * Clears all points from the collection
	 */
	async clearCollection(): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/clear-collection`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			await response.json()
		} catch (error) {
			console.error("Failed to clear collection:", error)
			throw error
		}
	}

	/**
	 * Deletes the entire collection.
	 */
	async deleteCollection(): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/vector-store/delete-collection`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.openRouterApiKey}`,
				},
				body: JSON.stringify({
					workspacePath: this.workspacePath,
				}),
			})

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			await response.json()
		} catch (error) {
			console.error("Failed to delete collection:", error)
			throw error
		}
	}

	/**
	 * Checks if the collection exists
	 * @returns Promise resolving to boolean indicating if the collection exists
	 */
	async collectionExists(): Promise<boolean> {
		try {
			const response = await fetch(
				`${this.baseUrl}/vector-store/collection-exists?workspacePath=${encodeURIComponent(this.workspacePath)}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.openRouterApiKey}`,
					},
				},
			)

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const result = await response.json()
			return result.exists || false
		} catch (error) {
			console.error("Failed to check if collection exists:", error)
			throw error
		}
	}
}
