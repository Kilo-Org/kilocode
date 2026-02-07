// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import type { ApiHandler, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

// Reuse existing handlers via delegation pattern
import { AnthropicHandler } from "./anthropic"
import { OpenAiHandler } from "./openai"
import { GeminiHandler } from "./gemini"
import { OpenAiCompatibleResponsesHandler } from "./openai-responses"

const AIHUBMIX_DEFAULT_BASE_URL = "https://aihubmix.com"
const AIHUBMIX_DEFAULT_MODEL = "claude-opus-4-5"

type ModelRoute = "anthropic" | "openai" | "openai-responses" | "gemini"
export class AihubmixHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private delegateHandler: ApiHandler | null = null
	private lastModelId: string | null = null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
	}

	/**
	 * Route to the appropriate handler based on model ID prefix
	 */
	private routeModel(modelId: string): ModelRoute {
		const id = modelId.toLowerCase()
		if (id.startsWith("claude")) {
			return "anthropic"
		}
		if (id.startsWith("gemini") && !id.endsWith("-nothink") && !id.endsWith("-search")) {
			return "gemini"
		}
		// gpt-5-pro and gpt-5-codex require OpenAI Responses API
		if (id === "gpt-5-pro" || id === "gpt-5-codex") {
			return "openai-responses"
		}
		return "openai"
	}

	/**
	 * Create delegate handler - reuses existing handler implementations
	 * Maps aihubmix configuration to the corresponding handler's configuration
	 */
	private getDelegateHandler(): ApiHandler {
		const modelId = this.options.aihubmixModelId || AIHUBMIX_DEFAULT_MODEL

		// Cache: reuse the same handler for the same model
		if (this.delegateHandler && this.lastModelId === modelId) {
			return this.delegateHandler
		}

		const baseUrl = this.options.aihubmixBaseUrl || AIHUBMIX_DEFAULT_BASE_URL
		const route = this.routeModel(modelId)

		switch (route) {
			case "anthropic":
				// Reuse AnthropicHandler with mapped configuration
				this.delegateHandler = new AnthropicHandler({
					...this.options,
					apiKey: this.options.aihubmixApiKey,
					anthropicBaseUrl: baseUrl,
					apiModelId: this.options.aihubmixModelId,
				})
				break

			case "gemini":
				// Reuse GeminiHandler with mapped configuration
				this.delegateHandler = new GeminiHandler({
					...this.options,
					geminiApiKey: this.options.aihubmixApiKey,
					googleGeminiBaseUrl: `${baseUrl}/gemini`,
					apiModelId: this.options.aihubmixModelId,
				})
				break

			case "openai-responses":
				// Reuse OpenAiCompatibleResponsesHandler for gpt-5-pro/gpt-5-codex models
				this.delegateHandler = new OpenAiCompatibleResponsesHandler({
					...this.options,
					openAiApiKey: this.options.aihubmixApiKey,
					openAiBaseUrl: `${baseUrl}/v1`,
					openAiModelId: this.options.aihubmixModelId,
				})
				break

			case "openai":
			default:
				// Reuse OpenAiHandler with mapped configuration
				this.delegateHandler = new OpenAiHandler({
					...this.options,
					openAiApiKey: this.options.aihubmixApiKey,
					openAiBaseUrl: `${baseUrl}/v1`,
					openAiModelId: this.options.aihubmixModelId,
				})
				break
		}

		this.lastModelId = modelId
		return this.delegateHandler
	}

	// ==================== Delegate to the corresponding handler ====================

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		yield* this.getDelegateHandler().createMessage(systemPrompt, messages, metadata)
	}

	getModel(): { id: string; info: ModelInfo } {
		return this.getDelegateHandler().getModel()
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		return this.getDelegateHandler().countTokens(content)
	}

	async completePrompt(prompt: string): Promise<string> {
		const handler = this.getDelegateHandler()
		if ("completePrompt" in handler) {
			return (handler as SingleCompletionHandler).completePrompt(prompt)
		}
		throw new Error("completePrompt not supported for this model")
	}
}
