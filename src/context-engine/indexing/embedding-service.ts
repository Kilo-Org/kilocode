import OpenAI from "openai"
import type { EmbeddingModel } from "../types"

/**
 * Embedding service supporting multiple providers (OpenAI, Voyage, Local)
 */
export class EmbeddingService {
	private model: EmbeddingModel
	private cache: Map<string, number[]>
	private batchQueue: string[]
	private batchTimeout: NodeJS.Timeout | null
	private openaiClient: OpenAI | null
	private cacheHits: number

	constructor(model: EmbeddingModel, openaiApiKey?: string, openaiBaseUrl?: string) {
		this.model = model
		this.cache = new Map()
		this.batchQueue = []
		this.batchTimeout = null
		this.cacheHits = 0

		// Initialize OpenAI client if needed
		if (model.provider === "openai") {
			this.openaiClient = new OpenAI({
				apiKey: openaiApiKey || process.env.OPENAI_API_KEY || "not-provided",
				baseURL: openaiBaseUrl,
			})
		} else {
			this.openaiClient = null
		}
	}

	/**
	 * Generate embedding for a single text
	 */
	async embed(text: string): Promise<number[]> {
		// Check cache first
		const cached = this.cache.get(text)
		if (cached) {
			this.cacheHits++
			return cached
		}

		let embedding: number[]

		switch (this.model.provider) {
			case "openai":
				embedding = await this.embedOpenAI([text])
				break
			case "voyage":
				embedding = await this.embedVoyage([text])
				break
			case "local":
				embedding = await this.embedLocal([text])
				break
			default:
				throw new Error(`Unknown provider: ${this.model.provider}`)
		}

		// Cache the result
		this.cache.set(text, embedding)
		return embedding
	}

	/**
	 * Generate embeddings for multiple texts (batch processing)
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		const embeddings: number[][] = []
		const uncachedTexts: string[] = []
		const uncachedIndices: number[] = []

		// Check cache for each text
		for (let i = 0; i < texts.length; i++) {
			const cached = this.cache.get(texts[i])
			if (cached) {
				embeddings[i] = cached
				this.cacheHits++
			} else {
				uncachedTexts.push(texts[i])
				uncachedIndices.push(i)
			}
		}

		if (uncachedTexts.length === 0) {
			return embeddings
		}

		// Generate embeddings for uncached texts
		let newEmbeddings: number[][]
		switch (this.model.provider) {
			case "openai":
				newEmbeddings = await this.embedOpenAIBatch(uncachedTexts)
				break
			case "voyage":
				newEmbeddings = await this.embedVoyageBatch(uncachedTexts)
				break
			case "local":
				newEmbeddings = await this.embedLocalBatch(uncachedTexts)
				break
			default:
				throw new Error(`Unknown provider: ${this.model.provider}`)
		}

		// Cache and insert results
		for (let i = 0; i < uncachedTexts.length; i++) {
			const embedding = newEmbeddings[i]
			this.cache.set(uncachedTexts[i], embedding)
			embeddings[uncachedIndices[i]] = embedding
		}

		return embeddings
	}

	private async embedOpenAI(texts: string[]): Promise<number[]> {
		if (!this.openaiClient) {
			throw new Error("OpenAI client not initialized")
		}

		try {
			const response = await this.openaiClient.embeddings.create({
				model: this.model.modelId,
				input: texts[0],
			})

			return response.data[0].embedding
		} catch (error) {
			console.error("OpenAI embedding error:", error)
			throw new Error(`Failed to generate OpenAI embedding: ${error}`)
		}
	}

	private async embedOpenAIBatch(texts: string[]): Promise<number[][]> {
		if (!this.openaiClient) {
			throw new Error("OpenAI client not initialized")
		}

		try {
			const response = await this.openaiClient.embeddings.create({
				model: this.model.modelId,
				input: texts,
			})

			return response.data.map((item) => item.embedding)
		} catch (error) {
			console.error("OpenAI batch embedding error:", error)
			throw new Error(`Failed to generate OpenAI batch embeddings: ${error}`)
		}
	}

	private async embedVoyage(texts: string[]): Promise<number[]> {
		// TODO: Implement Voyage AI API
		// For now, return a dummy embedding
		console.warn("Voyage embedding not yet implemented, returning dummy embedding")
		return new Array(this.model.dimensions).fill(0)
	}

	private async embedVoyageBatch(texts: string[]): Promise<number[][]> {
		// TODO: Implement Voyage AI batch API
		console.warn("Voyage batch embedding not yet implemented, returning dummy embeddings")
		return texts.map(() => new Array(this.model.dimensions).fill(0))
	}

	private async embedLocal(texts: string[]): Promise<number[]> {
		// TODO: Implement local embedding using CodeBERT/StarEncoder
		// For now, return a dummy embedding
		console.warn("Local embedding not yet implemented, returning dummy embedding")
		return new Array(this.model.dimensions).fill(0)
	}

	private async embedLocalBatch(texts: string[]): Promise<number[][]> {
		// TODO: Implement local batch embedding
		console.warn("Local batch embedding not yet implemented, returning dummy embeddings")
		return texts.map(() => new Array(this.model.dimensions).fill(0))
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	static cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have the same length")
		}

		let dotProduct = 0
		let normA = 0
		let normB = 0

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i]
			normA += a[i] * a[i]
			normB += b[i] * b[i]
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
	}

	/**
	 * Clear the embedding cache
	 */
	clearCache(): void {
		this.cache.clear()
		this.cacheHits = 0
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; hits: number } {
		return {
			size: this.cache.size,
			hits: this.cacheHits,
		}
	}
}
