import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { XmlMatcher } from "../../utils/xml-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { convertToSimpleMessages } from "../transform/simple-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { handleOpenAIError } from "./utils/openai-error-handler"
import {
	buildResponsesRequestBody,
	completePromptViaResponses,
	requiresResponsesApiForModel,
	streamResponsesAsApiStream,
	supportsResponsesApiForBaseUrl,
	type OpenAiResponsesMode,
} from "./utils/openai-responses-adapter"
import { ensureHttps, normalizeOpenAiResponsesBaseUrl } from "./utils/openai-url-utils"

// TODO: Rename this to OpenAICompatibleHandler. Also, I think the
// `OpenAINativeHandler` can subclass from this, since it's obviously
// compatible with the OpenAI API. We can also rename it to `OpenAIHandler`.
export class OpenAiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private responsesClient?: OpenAI
	private readonly providerName = "OpenAI"
	private readonly supportsResponsesApi: boolean
	private readonly responsesMode: OpenAiResponsesMode

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Normalize base URL early to ensure consistent https:// usage and avoid malformed URLs.
		const rawBaseUrl = this.options.openAiBaseUrl ?? "https://api.openai.com"
		const baseURL = ensureHttps(rawBaseUrl)
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const isAzureAiInference = this._isAzureAiInference(baseURL)
		const urlHost = this._getUrlHost(baseURL)
		const isAzureOpenAi = urlHost === "azure.com" || urlHost.endsWith(".azure.com") || options.openAiUseAzure

		/**
		 * Some OpenAI-compatible providers (incl. custom Azure-hosted ones) expose the
		 * Responses API under `/openai/v1/responses` without requiring an `api-version`
		 * query parameter. For these, the default Azure OpenAI client behaviour
		 * (which always appends api-version) breaks with "API version not supported".
		 *
		 * Heuristics:
		 * - If the baseURL already contains `/openai/v1` we treat it as a pure
		 *   OpenAI-compatible endpoint and MUST NOT append any api-version.
		 * - If the baseURL is just the Azure host (e.g. https://xxx.openai.azure.com),
		 *   we treat it as an OpenAI-style responses endpoint base and will derive
		 *   `/openai/v1/responses` from it when im Responses-Modus.
		 */
		const isOpenAiStyleAzureBase = typeof baseURL === "string" && baseURL.includes("/openai/v1")

		this.supportsResponsesApi = supportsResponsesApiForBaseUrl(baseURL)
		this.responsesMode = ((this.options as any).openAiResponsesMode as OpenAiResponsesMode | undefined) ?? "auto"

		/**
		 * Wenn der User explizit den API-Modus "responses" gewählt hat und
		 * der Provider laut Heuristik die Responses-API unterstützt, normalisieren
		 * wir die Base-URL für die Responses-API.
		 *
		 * Wichtig:
		 * - Die Responses-API erwartet IMMER den Pfad `/openai/v1/responses`.
		 * - Azure-spezifische `api-version` Query-Parameter dürfen an der Responses-URL
		 *   nicht hängen, sie werden in `normalizeOpenAiResponsesBaseUrl` entfernt.
		 *
		 * Erwartete Eingaben im UI:
		 *
		 *   baseURL: https://myendpoint.openai.azure.com
		 *   → https://myendpoint.openai.azure.com/openai/v1/responses
		 *
		 *   baseURL: https://myendpoint.openai.azure.com/openai/v1
		 *   → https://myendpoint.openai.azure.com/openai/v1/responses
		 *
		 *   baseURL: https://myendpoint.openai.azure.com/openai/v1/responses
		 *   → https://myendpoint.openai.azure.com/openai/v1/responses
		 *
		 * Für generische OpenAI-kompatible Endpoints (nicht Azure) gilt:
		 *
		 *   baseURL: https://host/api
		 *   → https://host/api/responses
		 */
		const apiMode = this.getApiMode()

		// Responses-Base-URL IMMER nur aus der Host-Basis normalisieren.
		// WICHTIG:
		// - Wir verwenden ausschließlich `origin` (Schema + Host), um zu verhindern,
		//   dass ein bereits gesetzter `/openai/v1/responses`-Pfad erneut transformiert wird.
		// - Damit kann der User im UI zwar einen voll qualifizierten Pfad angeben,
		//   für den Responses-Client wird aber immer nur die Resource-Host-Basis genutzt
		//   und dann exakt einmal `/openai/v1/responses` angehängt.
		const hostOnlyBaseUrl = (() => {
			try {
				const parsed = new URL(baseURL)
				return `${parsed.protocol}//${parsed.host}`
			} catch {
				// Falls baseURL kein gültiger URL-String ist (z. B. nur Hostname),
				// übergeben wir ihn direkt an normalizeOpenAiResponsesBaseUrl,
				// das dann `ensureHttps` und die weitere Normalisierung übernimmt.
				return baseURL
			}
		})()

		const responsesBaseUrl =
			apiMode === "responses" && this.supportsResponsesApi
				? normalizeOpenAiResponsesBaseUrl(hostOnlyBaseUrl)
				: undefined
		;(this as any)._responsesBaseUrl = responsesBaseUrl

		const headers = {
			...DEFAULT_HEADERS,
			...(this.options.openAiHeaders || {}),
		}

		const timeout = getApiRequestTimeout()

		// IMPORTANT:
		// - For Responses API we must NEVER attach Azure `api-version` query params.
		//   Therefore we create a dedicated OpenAI client (never AzureOpenAI) for Responses mode.
		if (responsesBaseUrl) {
			this.responsesClient = new OpenAI({
				baseURL: responsesBaseUrl,
				apiKey,
				defaultHeaders: headers,
				timeout,
			})
		}

		// WICHTIG:
		// - Azure OpenAI (.openai.azure.com / .cognitiveservices.azure.com) darf KEINE api-version
		//   im Query für die Responses-API haben. Wir nutzen im Responses-Modus daher immer `responsesClient`.
		// - Azure AI Inference (.services.ai.azure.com) soll NUR im Completions-Modus (chat/completions)
		//   automatisch eine api-version im Query anhängen, NICHT im Responses-Modus.
		if (isAzureOpenAi && !isOpenAiStyleAzureBase) {
			// Azure OpenAI (klassische Endpunkte, z. B. https://myendpoint.openai.azure.com)
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: headers,
				timeout,
			})
		} else if (isAzureAiInference && !isOpenAiStyleAzureBase) {
			// Azure AI Inference Service (z. B. *.services.ai.azure.com)
			// Nur wenn wir im Completions-Modus sind, hängen wir api-version als Query an.
			const defaultQuery =
				apiMode === "completions"
					? { "api-version": this.options.azureApiVersion || "2024-05-01-preview" }
					: undefined

			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				defaultQuery,
				timeout,
			})
		} else if (isOpenAiStyleAzureBase) {
			// OpenAI-compatible service hosted on *.azure.com that expects pure
			// OpenAI-style URLs (e.g. https://...azure.com/openai/v1/responses)
			// WITHOUT any api-version query parameter.
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout,
			})
		} else {
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout,
			})
		}
	}

	private getApiMode(): "completions" | "responses" {
		// Default to completions for backward compatibility.
		// NOTE: This legacy flag is kept only for backwards-compat configs.
		const mode = (this.options as any).openAiApiMode as "completions" | "responses" | undefined
		return mode ?? "completions"
	}

	private isAzureHost(baseUrl?: string): boolean {
		const host = this._getUrlHost(baseUrl)
		return host.endsWith(".openai.azure.com") || host.endsWith(".cognitiveservices.azure.com")
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelUrl = this.options.openAiBaseUrl ?? ""
		const modelId = this.options.openAiModelId ?? ""
		const enabledR1Format = this.options.openAiR1FormatEnabled ?? false
		const enabledLegacyFormat = this.options.openAiLegacyFormat ?? false
		const isAzureAiInference = this._isAzureAiInference(modelUrl)
		const deepseekReasoner = modelId.includes("deepseek-reasoner") || enabledR1Format
		const ark = modelUrl.includes(".volces.com")

		const apiMode = this.getApiMode()
		const isAzureHost = this.isAzureHost(modelUrl)
		const isCodexModel = modelId.toLowerCase().includes("codex")
		const useTextInput = isAzureHost && isCodexModel

		// Backwards compatibility:
		// If legacy openAiApiMode explicitly requests "responses",
		// treat it as if responsesMode had been set to "force".
		const effectiveResponsesMode: OpenAiResponsesMode =
			apiMode === "responses" && this.supportsResponsesApi && this.responsesMode === "auto"
				? "force"
				: this.responsesMode

		const responsesBaseUrl = (this as any)._responsesBaseUrl as string | undefined

		// Harte Policy:
		// - Wenn im UI explizit "completions" gewählt wurde, verwenden wir NIEMALS
		//   die Responses-API, unabhängig von Modell-Heuristiken.
		if (apiMode === "completions") {
			// completions/chat-Zweig folgt weiter unten unverändert.
			// Wir setzen shouldUseResponses einfach auf false.
		}

		const shouldUseResponses =
			apiMode === "completions"
				? false
				: effectiveResponsesMode === "force"
					? this.supportsResponsesApi
					: effectiveResponsesMode === "off"
						? false
						: this.supportsResponsesApi && requiresResponsesApiForModel(modelId, modelInfo)

		if (shouldUseResponses) {
			const temperature = this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0)
			const requestBody = buildResponsesRequestBody({
				modelId,
				modelInfo,
				systemPrompt,
				messages,
				metadata,
				streaming: true,
				temperature,
				// Note: keep max_output_tokens conservative; if includeMaxTokens is enabled we map to model maxTokens.
				maxOutputTokens:
					this.options.includeMaxTokens === true
						? (this.options.modelMaxTokens ?? modelInfo.maxTokens ?? undefined)
						: undefined,
				store: this.options.openAiResponsesStoreEnabled ?? false,
			})

			// For Responses API we MUST NOT use AzureOpenAI (it always appends api-version).
			const clientForResponses = (this.responsesClient ?? this.client) as any

			yield* streamResponsesAsApiStream({
				client: clientForResponses,
				requestBody,
				providerName: this.providerName,
				requestOptions: undefined,
			})
			return
		}

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages, metadata)
			return
		}

		let systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		if (this.options.openAiStreamingEnabled ?? true) {
			let convertedMessages

			if (deepseekReasoner) {
				convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			} else if (ark || enabledLegacyFormat) {
				convertedMessages = [systemMessage, ...convertToSimpleMessages(messages)]
			} else {
				if (modelInfo.supportsPromptCache) {
					systemMessage = {
						role: "system",
						content: [
							{
								type: "text",
								text: systemPrompt,
								// @ts-ignore-next-line
								cache_control: { type: "ephemeral" },
							},
						],
					}
				}

				convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

				if (modelInfo.supportsPromptCache) {
					// Note: the following logic is copied from openrouter:
					// Add cache_control to the last two user messages
					// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
					const lastTwoUserMessages = convertedMessages.filter((msg) => msg.role === "user").slice(-2)

					lastTwoUserMessages.forEach((msg) => {
						if (typeof msg.content === "string") {
							msg.content = [{ type: "text", text: msg.content }]
						}

						if (Array.isArray(msg.content)) {
							// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
							let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

							if (!lastTextPart) {
								lastTextPart = { type: "text", text: "..." }
								msg.content.push(lastTextPart)
							}

							// @ts-ignore-next-line
							lastTextPart["cache_control"] = { type: "ephemeral" }
						}
					})
				}
			}

			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			// Prefer a responses-specific base URL if one was configured in the constructor
			// (apiMode === "responses" & supportsResponsesApi). This ensures that for
			// OpenAI-compatible providers we call `/openai/v1/responses` exactly.
			const responsesBaseUrl = (this as any).clientBaseUrlForResponses as string | undefined

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				temperature: this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
				messages: convertedMessages,
				stream: true as const,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				...(reasoning && reasoning),
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" && {
					parallel_tool_calls: metadata.parallelToolCalls ?? false,
				}),
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			let lastUsage

			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta ?? {}

				if (delta.content) {
					for (const chunk of matcher.update(delta.content)) {
						yield chunk
					}
				}

				// kilocode_change start: reasoning
				const reasoningText =
					"reasoning_content" in delta && typeof delta.reasoning_content === "string"
						? delta.reasoning_content
						: "reasoning" in delta && typeof delta.reasoning === "string"
							? delta.reasoning
							: undefined
				if (reasoningText) {
					yield {
						type: "reasoning",
						text: reasoningText,
					}
				}
				// kilocode_change end

				if (delta.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCall.id,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}

				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}

			for (const chunk of matcher.final()) {
				yield chunk
			}

			if (lastUsage) {
				yield this.processUsageMetrics(lastUsage, modelInfo)
			}
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: deepseekReasoner
					? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
					: enabledLegacyFormat
						? [systemMessage, ...convertToSimpleMessages(messages)]
						: [systemMessage, ...convertToOpenAiMessages(messages)],
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" && {
					parallel_tool_calls: metadata.parallelToolCalls ?? false,
				}),
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					this._isAzureAiInference(modelUrl) ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			// kilocode_change start: reasoning
			const message = response.choices[0]?.message
			if (message) {
				if ("reasoning" in message && typeof message.reasoning === "string") {
					yield {
						type: "reasoning",
						text: message.reasoning,
					}
				}
				if (message.content) {
					yield {
						type: "text",
						text: message.content || "",
					}
				}
			}
			// kilocode_change end

			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}

			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	protected processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.cache_creation_input_tokens || undefined,
			cacheReadTokens: usage?.cache_read_input_tokens || undefined,
		}
	}

	override getModel() {
		const id = this.options.openAiModelId ?? ""
		const info = this.options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
			const model = this.getModel()
			const modelInfo = model.info

			const apiMode = this.getApiMode()
			const effectiveResponsesMode: OpenAiResponsesMode =
				apiMode === "responses" && this.supportsResponsesApi && this.responsesMode === "auto"
					? "force"
					: this.responsesMode

			const shouldUseResponses =
				apiMode === "completions"
					? false
					: effectiveResponsesMode === "force"
						? this.supportsResponsesApi
						: effectiveResponsesMode === "off"
							? false
							: this.supportsResponsesApi && requiresResponsesApiForModel(model.id, modelInfo)

			if (shouldUseResponses) {
				const requestBody = buildResponsesRequestBody({
					modelId: model.id,
					modelInfo,
					systemPrompt: "",
					messages: [{ role: "user", content: prompt }],
					metadata: undefined,
					streaming: false,
					temperature: this.options.modelTemperature ?? 0,
					maxOutputTokens:
						this.options.includeMaxTokens === true
							? (this.options.modelMaxTokens ?? modelInfo.maxTokens ?? undefined)
							: undefined,
					store: this.options.openAiResponsesStoreEnabled ?? false,
				})

				// For Responses API we MUST NOT use AzureOpenAI (it always appends api-version).
				const clientForResponses = (this.responsesClient ?? this.client) as any

				return await completePromptViaResponses({
					client: clientForResponses,
					requestBody,
					providerName: this.providerName,
				})
			}

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} completion error: ${error.message}`)
			}

			throw error
		}
	}

	private async *handleO3FamilyMessage(
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelInfo = this.getModel().info
		const methodIsAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)

		if (this.options.openAiStreamingEnabled ?? true) {
			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" && {
					parallel_tool_calls: metadata.parallelToolCalls ?? false,
				}),
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield* this.handleStreamResponse(stream)
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
				...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
				...(metadata?.toolProtocol === "native" && {
					parallel_tool_calls: metadata.parallelToolCalls ?? false,
				}),
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message
			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	private async *handleStreamResponse(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): ApiStream {
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta

			if (delta) {
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if (delta.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCall.id,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}
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

	private _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").host
		} catch (error) {
			return ""
		}
	}

	private _isGrokXAI(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.includes("x.ai")
	}

	private _isAzureAiInference(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.endsWith(".services.ai.azure.com")
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	try {
		if (!baseUrl) {
			return []
		}

		// Trim whitespace from baseUrl to handle cases where users accidentally include spaces
		const trimmedBaseUrl = baseUrl.trim()

		if (!URL.canParse(trimmedBaseUrl)) {
			return []
		}

		const config: Record<string, any> = {}
		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			...(openAiHeaders || {}),
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		if (Object.keys(headers).length > 0) {
			config["headers"] = headers
		}

		const response = await axios.get(`${trimmedBaseUrl}/models`, config)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}
