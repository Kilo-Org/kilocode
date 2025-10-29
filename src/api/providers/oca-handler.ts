import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/constants"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { getOcaClientInfo } from "./utils/getOcaClientInfo"

import { DEFAULT_HEADERS as BASE_HEADERS } from "./constants"

const DEFAULT_HEADERS = {
	...BASE_HEADERS,
	Accept: "application/json",
	"Content-Type": "application/json",
}

/**
 * Oracle Code Assist provider handler.
 * Responsibilities:
 * - Acquire a valid access token via OcaTokenManager
 * - Construct an OpenAI-compatible client with base URL and headers
 * - Stream chat completions and surface usage events
 *
 * Notes:
 * - Secret storage is handled exclusively by OcaTokenManager (SRP)
 * - Base URL can be overridden by process.env.OCA_API_BASE
 */
export class OcaHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private baseURL: string

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.baseURL = process.env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
	}

	private async getClient(): Promise<OpenAI> {
		return this.getClientWithBase(this.baseURL)
	}

	private async getClientWithBase(baseURL: string): Promise<OpenAI> {
		const token = await OcaTokenManager.getValid()
		if (!token?.access_token) {
			throw new Error("Please sign in with Oracle SSO at Settings > Providers > Oracle Code Assist.")
		}

		const { client, clientVersion, clientIde, clientIdeVersion } = getOcaClientInfo()

		return new OpenAI({
			apiKey: token.access_token,
			baseURL,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				client: client,
				"client-version": clientVersion,
				"client-ide": clientIde,
				"client-ide-version": clientIdeVersion,
			},
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: any[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const client = await this.getClient()

		const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: this.options.apiModelId || "auto",
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			temperature: this.options.modelTemperature ?? 0,
			stream: true as const,
			stream_options: { include_usage: true },
		}

		let stream
		try {
			stream = await client.chat.completions.create(request)
		} catch (err: any) {
			// Retry once with alternate base if 404 (route mismatch /v1)
			throw handleOpenAIError(err, "Oracle Code Assist")
		}

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
			if ("reasoning_content" in (delta || {}) && typeof (delta as any).reasoning_content === "string") {
				yield { type: "reasoning", text: (delta as any).reasoning_content as string }
			}
			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const client = await this.getClient()
		try {
			const resp = await client.chat.completions.create({
				model: this.options.apiModelId || "auto",
				messages: [{ role: "user", content: prompt }],
			} as any)
			return (resp as any).choices?.[0]?.message?.content || ""
		} catch (err: any) {
			throw handleOpenAIError(err, "Oracle Code Assist")
		}
	}

	override getModel() {
		const id = this.options.apiModelId || "auto"
		const info: ModelInfo = {
			maxTokens: this.options.modelMaxTokens || 4096,
			contextWindow: 128000,
			supportsImages: true,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
		}
		return { id, info }
	}
}
