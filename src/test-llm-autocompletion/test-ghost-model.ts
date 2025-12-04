import { LLMClient } from "./llm-client.js"
import { ApiStreamChunk } from "../api/transform/stream.js"
import { ChatCompletionModel } from "../services/ghost/classic-auto-complete/HoleFiller.js"
import { FimCompletionModel } from "../services/ghost/classic-auto-complete/FillInTheMiddle.js"

/**
 * Check if a model supports FIM (Fill-In-Middle) completions.
 * This mirrors the logic in KilocodeOpenrouterHandler.supportsFim()
 */
function modelSupportsFim(modelId: string): boolean {
	return modelId.includes("codestral")
}

/**
 * A test adapter that implements the ChatCompletionModel and FimCompletionModel interfaces using LLMClient.
 * This allows the test harness to use the same production code paths
 * (HoleFiller.getFromChat, FimPromptBuilder.getFromFIM) as the real provider.
 */
export class TestGhostModel implements ChatCompletionModel, FimCompletionModel {
	private llmClient: LLMClient
	private modelName: string

	constructor() {
		this.modelName = process.env.LLM_MODEL || "mistralai/codestral-2508"
		this.llmClient = new LLMClient()
	}

	supportsFim(): boolean {
		return modelSupportsFim(this.modelName)
	}

	getModelName(): string | undefined {
		return this.modelName
	}

	getProviderDisplayName(): string | undefined {
		return "kilocode-test"
	}

	hasValidCredentials(): boolean {
		return true
	}

	/**
	 * Generate FIM completion - matches GhostModel.generateFimResponse signature
	 */
	async generateFimResponse(
		prefix: string,
		suffix: string,
		onChunk: (text: string) => void,
		_taskId?: string,
	): Promise<{
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}> {
		const response = await this.llmClient.sendFimCompletion(prefix, suffix)

		// Call onChunk with the full completion (LLMClient doesn't stream)
		onChunk(response.completion)

		return {
			cost: 0,
			inputTokens: response.tokensUsed ?? 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}
	}

	/**
	 * Generate chat response - matches GhostModel.generateResponse signature
	 */
	async generateResponse(
		systemPrompt: string,
		userPrompt: string,
		onChunk: (chunk: ApiStreamChunk) => void,
	): Promise<{
		cost: number
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
	}> {
		const response = await this.llmClient.sendPrompt(systemPrompt, userPrompt)

		// Call onChunk with the full response as a text chunk
		onChunk({ type: "text", text: response.content })

		return {
			cost: 0,
			inputTokens: response.tokensUsed ?? 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}
	}
}
