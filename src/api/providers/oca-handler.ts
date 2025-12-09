import OpenAI from "openai"

import { type ModelInfo, NATIVE_TOOL_DEFAULTS } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/utils/constants"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { getOcaClientInfo } from "./oca/utils/getOcaClientInfo"

import { DEFAULT_HEADERS as BASE_HEADERS } from "./constants"
import { getModelsFromCache } from "./fetchers/modelCache"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"

const DEFAULT_HEADERS = {
	...BASE_HEADERS,
	Accept: "application/json",
	"Content-Type": "application/json",
}

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

	private decorateErrorWithOpcRequestId(error: any, processedError: any) {
		const opcRequestId =
			typeof error?.headers?.get === "function" ? (error.headers.get("opc-request-id") as string | null) : null

		if (opcRequestId && processedError && typeof processedError === "object" && "message" in processedError) {
			;(processedError as any).message = `${(processedError as any).message} opc-request-id: ${opcRequestId}`
		}
		return processedError
	}

	override async *createMessage(
		systemPrompt: string,
		messages: any[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const client = await this.getClient()

		
		const { info: modelInfo } = this.getModel()

		const supportsNativeTools = modelInfo.supportsNativeTools ?? false
		const useNativeTools =
			supportsNativeTools &&
			metadata?.tools &&
			metadata.tools.length > 0 &&
			metadata?.toolProtocol !== "xml" &&
			metadata?.tool_choice !== "none"

		const requestedToolChoice = metadata?.tool_choice
		const finalToolChoice =
			useNativeTools && (!requestedToolChoice || requestedToolChoice === "auto") ? "required" : requestedToolChoice

		const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: this.options.apiModelId || "auto",
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			...(modelInfo.maxTokens ? { max_tokens: modelInfo.maxTokens } : {}),
			temperature: this.options.modelTemperature ?? 0,
			stream: true as const,
			stream_options: { include_usage: true },
			...(useNativeTools && { tools: this.convertToolsForOpenAI(metadata!.tools) }),
			...(finalToolChoice && { tool_choice: finalToolChoice }),
			...(useNativeTools && { parallel_tool_calls: metadata?.parallelToolCalls ?? false }),
		}

		let stream
		try {
			stream = await client.chat.completions.create(request)
		} catch (err: any) {
			throw this.decorateErrorWithOpcRequestId(err, handleOpenAIError(err, "Oracle Code Assist"))
		}

		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			verifyFinishReason(chunk.choices?.[0] as any)
			const choice = (chunk.choices?.[0] as any) || {}
			const delta = choice?.delta
			const finishReason = choice?.finish_reason

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					if (toolCall.id) {
						activeToolCallIds.add(toolCall.id)
					}
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}
			{
				const reasoningText =
					("reasoning_content" in (delta || {}) && typeof (delta as any).reasoning_content === "string"
						? (delta as any).reasoning_content
						: "reasoning" in (delta || {}) && typeof (delta as any).reasoning === "string"
							? (delta as any).reasoning
							: undefined) as string | undefined
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}
			}
			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
		if (activeToolCallIds.size > 0) {
			for (const id of activeToolCallIds) {
				yield { type: "tool_call_end", id }
			}
			activeToolCallIds.clear()
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
			throw this.decorateErrorWithOpcRequestId(err, handleOpenAIError(err, "Oracle Code Assist"))
		}
	}

	override getModel() {
		const id = this.options.apiModelId || "auto"
		const cached = getModelsFromCache("oca")
		const selected = id !== "auto" ? cached?.[id] : undefined

		const baseInfo: ModelInfo = {
			maxTokens: this.options.modelMaxTokens ?? selected?.maxTokens ?? 4096,
			contextWindow: selected?.contextWindow ?? 128000,
			supportsImages: selected?.supportsImages ?? true,
			supportsPromptCache: selected?.supportsPromptCache ?? false,
			inputPrice: selected?.inputPrice ?? 0,
			outputPrice: selected?.outputPrice ?? 0,
			cacheWritesPrice: selected?.cacheWritesPrice,
			cacheReadsPrice: selected?.cacheReadsPrice,
			description: selected?.description,
			banner: selected?.banner,
		}
		const info: ModelInfo = {
			...NATIVE_TOOL_DEFAULTS,
			...baseInfo,
		}

		return { id, info }
	}
}
