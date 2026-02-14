import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	Completion,
	CompletionCreateParamsNonStreaming,
	CompletionCreateParamsStreaming,
	Model,
} from "openai/resources/index"
import { CometAPIConfig } from "../types.js"
import { BaseLlmApi, CreateRerankResponse, FimCreateParamsStreaming, RerankCreateParams } from "./base.js"
import { OpenAIApi } from "./OpenAI.js"

/**
 * CometAPI adapter - extends OpenAI adapter since CometAPI is OpenAI-compatible
 *
 * CometAPI provides access to multiple LLM providers (GPT, Claude, Gemini, etc.)
 * through a unified OpenAI-compatible API interface.
 */
export class CometAPIApi extends OpenAIApi implements BaseLlmApi {
	// Store the original CometAPI config separately

	constructor(config: CometAPIConfig) {
		// CometAPI uses OpenAI-compatible API, so we can reuse OpenAI adapter
		// Convert CometAPI config to OpenAI-compatible config for the base class
		const openAICompatibleConfig = {
			...config,
			provider: "openai" as const,
			apiBase: config.apiBase ?? "https://api.cometapi.com/v1/",
		}
		super(openAICompatibleConfig)
	}

	/**
	 * Override list method to handle CometAPI-specific model filtering
	 * The core filtering logic is handled in the CometAPI provider class
	 */
	override async list(): Promise<Model[]> {
		try {
			return await super.list()
		} catch (error) {
			// Fallback to empty list if model listing fails
			console.warn("CometAPI: Failed to fetch model list", error)
			return []
		}
	}

	/**
	 * Chat completion - uses OpenAI-compatible format
	 */
	override async chatCompletionNonStream(
		body: ChatCompletionCreateParamsNonStreaming,
		signal: AbortSignal,
	): Promise<ChatCompletion> {
		return super.chatCompletionNonStream(body, signal)
	}

	/**
	 * Streaming chat completion - uses OpenAI-compatible format
	 */
	override async *chatCompletionStream(
		body: ChatCompletionCreateParamsStreaming,
		signal: AbortSignal,
	): AsyncGenerator<ChatCompletionChunk> {
		yield* super.chatCompletionStream(body, signal)
	}

	/**
	 * Legacy completion endpoint support
	 */
	override completionNonStream(body: CompletionCreateParamsNonStreaming, signal: AbortSignal): Promise<Completion> {
		return super.completionNonStream(body, signal)
	}

	/**
	 * Legacy streaming completion endpoint support
	 */
	override completionStream(body: CompletionCreateParamsStreaming, signal: AbortSignal): AsyncGenerator<Completion> {
		return super.completionStream(body, signal)
	}

	/**
	 * Fill-in-the-middle completion support
	 */
	override fimStream(body: FimCreateParamsStreaming, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk> {
		return super.fimStream(body, signal)
	}

	/**
	 * Reranking support (if available through CometAPI)
	 */
	override async rerank(body: RerankCreateParams): Promise<CreateRerankResponse> {
		try {
			return await super.rerank(body)
		} catch (error) {
			throw new Error(`CometAPI reranking not supported: ${error}`)
		}
	}
}
