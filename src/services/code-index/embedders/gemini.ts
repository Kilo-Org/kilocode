import fetch from "node-fetch"
import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

export class GeminiEmbedder implements IEmbedder {
	private readonly openAICompatibleEmbedder?: OpenAICompatibleEmbedder
	private static readonly DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
	private static readonly DEFAULT_MODEL = "gemini-embedding-001"
	private readonly modelId: string
	private readonly apiKey: string
	private readonly baseUrl: string
	private readonly isCustom: boolean

	constructor(apiKey: string, modelId?: string, baseUrl?: string) {
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		this.apiKey = apiKey
		this.modelId = modelId || GeminiEmbedder.DEFAULT_MODEL
		this.isCustom = !!baseUrl
		this.baseUrl = baseUrl || GeminiEmbedder.DEFAULT_BASE_URL

		if (!this.isCustom) {
			this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
				this.baseUrl,
				this.apiKey,
				this.modelId,
				GEMINI_MAX_ITEM_TOKENS,
			)
		}
	}

	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.modelId

		if (!this.isCustom && this.openAICompatibleEmbedder) {
			return this.openAICompatibleEmbedder.createEmbeddings(texts, modelToUse)
		}

		try {
			const response = await fetch(this.baseUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					input: texts,
					model: modelToUse,
				}),
			})

			if (!response.ok) {
				const errorBody = await response.text()
				console.error(`Gemini custom endpoint error: ${response.status} ${response.statusText}`, errorBody)
				throw new Error(`API request failed with status ${response.status}: ${errorBody}`)
			}

			const data = (await response.json()) as any
			return {
				embeddings: data.data.map((d: any) => d.embedding),
				usage: {
					promptTokens: 0,
					totalTokens: data.usage.total_tokens,
				},
			}
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "GeminiEmbedder:createEmbeddings:custom",
			})
			console.error("Gemini custom embedder error in createEmbeddings:", error)
			throw error
		}
	}

	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		if (!this.isCustom && this.openAICompatibleEmbedder) {
			return this.openAICompatibleEmbedder.validateConfiguration()
		}

		// For custom URLs, we perform a lazy validation. We assume the URL is valid
		// and let any potential errors be caught during the actual embedding process.
		// This provides more flexibility for users with custom proxy setups.
		return { valid: true }
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "gemini",
		}
	}
}
