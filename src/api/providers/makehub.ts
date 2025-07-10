import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { Package } from "../../shared/package"
import { type ModelInfo, makehubDefaultModelId, makehubDefaultModelInfo } from "@roo-code/types"
import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { RouterProvider } from "./router-provider"

const MAKEHUB_BASE_URL = "https://api.makehub.ai/v1"
const MAKEHUB_DEFAULT_TEMPERATURE = 0

const DEFAULT_HEADERS = {
	"X-Makehub-Metadata": JSON.stringify({
		labels: [{ key: "app", value: `vscode.${Package.publisher}.${Package.name}` }],
	}),
}

export class MakeHubHandler extends RouterProvider {
	private lastGenerationId?: string

	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "makehub",
			baseURL: MAKEHUB_BASE_URL,
			apiKey: options.makehubApiKey,
			modelId: options.makehubModelId,
			defaultModelId: makehubDefaultModelId,
			defaultModelInfo: makehubDefaultModelInfo,
		})
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined
		const { id: modelId, info: modelInfo } = await this.fetchModel()

		// Convert messages to OpenAI format
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Extract actual model ID without duplicating the organization
		// The model ID from MakeHub is already in the format 'organization/model_name'
		// We need to use it as is without modification
		const actualModelId = modelId

		// Set request options
		const requestOptions: OpenAI.Chat.ChatCompletionCreateParams = {
			model: actualModelId,
			messages: openAiMessages,
			stream: true,
		}

		// Set temperature if supported
		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? MAKEHUB_DEFAULT_TEMPERATURE
		}

		// Set performance ratio header
		const perfRatio = this.options.makehubPerfRatio ?? 0.5 // Default balanced value
		const headers = {
			...DEFAULT_HEADERS,
			"X-Price-Performance-Ratio": `${Math.round(perfRatio * 100)}`,
		}

		// Check if we need to use R1 format for specific models
		const modelLower = modelId.toLowerCase()
		if (modelLower.includes("deepseek") || modelLower.includes("qwen") || modelLower.includes("qwq")) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			requestOptions.messages = openAiMessages
		}

		// Make API request
		const { data: completion } = await this.client.chat.completions
			.create(requestOptions, { headers })
			.withResponse()

		let didOutputUsage = false

		for await (const chunk of completion) {
			// Capture generation ID for future statistics
			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			// Handle usage statistics if present
			if (!didOutputUsage && chunk.usage) {
				// Validate token counts to prevent unreasonable values
				const promptTokens = chunk.usage.prompt_tokens || 0
				const completionTokens = chunk.usage.completion_tokens || 0

				// Check if token counts are reasonable (typically not more than 100k tokens in a single request)
				const maxReasonableTokens = 100000
				const validPromptTokens = promptTokens > maxReasonableTokens ? maxReasonableTokens : promptTokens
				const validCompletionTokens =
					completionTokens > maxReasonableTokens ? maxReasonableTokens : completionTokens

				if (promptTokens > maxReasonableTokens || completionTokens > maxReasonableTokens) {
					console.warn("MakeHub returned unusually high token counts, applying limits", {
						original: { promptTokens, completionTokens },
						corrected: { validPromptTokens, validCompletionTokens },
					})
				}

				yield {
					type: "usage",
					inputTokens: validPromptTokens,
					outputTokens: validCompletionTokens,
					totalCost: this.calculateCost(validPromptTokens, validCompletionTokens, modelInfo),
				}
				didOutputUsage = true
			}
		}
	}

	/**
	 * Calculate cost based on input and output tokens
	 */
	private calculateCost(inputTokens: number, outputTokens: number, modelInfo: any): number {
		// Validate inputs
		if (!modelInfo || typeof modelInfo.inputPrice !== "number" || typeof modelInfo.outputPrice !== "number") {
			console.warn("MakeHub: Invalid model pricing information", { modelInfo })
			return 0
		}

		if (inputTokens < 0 || outputTokens < 0) {
			console.warn("MakeHub: Invalid token counts", { inputTokens, outputTokens })
			return 0
		}

		// MakeHub API returns prices in dollars per million tokens
		const inputCost = (inputTokens / 1_000_000) * modelInfo.inputPrice
		const outputCost = (outputTokens / 1_000_000) * modelInfo.outputPrice
		const totalCost = inputCost + outputCost

		// Log for debugging only if cost seems unusual
		if (totalCost > 10) {
			console.log("MakeHub high cost calculation:", {
				inputTokens,
				outputTokens,
				inputPrice: modelInfo.inputPrice,
				outputPrice: modelInfo.outputPrice,
				inputCost,
				outputCost,
				totalCost,
			})
		}

		return Math.max(0, totalCost)
	}

	protected override supportsTemperature(modelId: string): boolean {
		// Most models support temperature, but exclude o3-mini variants like OpenAI
		return !modelId.toLowerCase().includes("o3-mini")
	}
}
