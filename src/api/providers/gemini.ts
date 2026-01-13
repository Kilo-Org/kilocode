import type { Anthropic } from "@anthropic-ai/sdk"
import {
	GoogleGenAI,
	type GenerateContentResponseUsageMetadata,
	type GenerateContentParameters,
	type GenerateContentConfig,
	type GroundingMetadata,
	FinishReason, // kilocode_change
	FunctionCallingConfigMode,
} from "@google/genai"
import type { JWTInput } from "google-auth-library"

import {
	type ModelInfo,
	// type GeminiModelId, // kilocode_change
	geminiDefaultModelId,
	geminiModels,
} from "@roo-code/types"

import type {
	ApiHandlerOptions,
	ModelRecord, // kilocode_change
} from "../../shared/api"
import { safeJsonParse } from "../../shared/safeJsonParse"

import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { t } from "i18next"
import type { ApiStream, GroundingSource } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { throwMaxCompletionTokensReachedError } from "./kilocode/verifyFinishReason"
import { getGeminiModels } from "./fetchers/gemini" // kilocode_change

type GeminiHandlerOptions = ApiHandlerOptions & {
	isVertex?: boolean
}

export class GeminiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions

	private client: GoogleGenAI
	private lastThoughtSignature?: string
	private lastResponseId?: string

	// kilocode_change start
	private models: ModelRecord = { ...geminiModels }
	private modelsLoaded = false
	private modelsLoading?: Promise<void>
	private readonly isVertex: boolean
	// kilocode_change end

	constructor({ isVertex, ...options }: GeminiHandlerOptions) {
		super()

		this.options = options
		this.isVertex = !!isVertex // kilocode_change

		const project = this.options.vertexProjectId ?? "not-provided"
		const location = this.options.vertexRegion ?? "not-provided"
		const apiKey = this.options.geminiApiKey ?? "not-provided"

		this.client = this.options.vertexJsonCredentials
			? new GoogleGenAI({
					vertexai: true,
					project,
					location,
					googleAuthOptions: {
						credentials: safeJsonParse<JWTInput>(this.options.vertexJsonCredentials, undefined),
					},
				})
			: this.options.vertexKeyFile
				? new GoogleGenAI({
						vertexai: true,
						project,
						location,
						googleAuthOptions: { keyFile: this.options.vertexKeyFile },
					})
				: isVertex
					? new GoogleGenAI({ vertexai: true, project, location })
					: new GoogleGenAI({ apiKey })
	}

	// kilocode_change start
	private async ensureModelsLoaded() {
		if (this.isVertex) {
			return
		}

		if (this.modelsLoaded) {
			return
		}

		if (!this.modelsLoading) {
			this.modelsLoading = this.loadModels().finally(() => {
				this.modelsLoaded = true
				this.modelsLoading = undefined
			})
		}

		await this.modelsLoading
	}

	private async loadModels() {
		try {
			this.models = await getGeminiModels({
				apiKey: this.options.geminiApiKey,
				baseUrl: this.options.googleGeminiBaseUrl,
			})
		} catch (error) {
			console.error("[GeminiHandler] Failed to fetch Gemini models", error)
			this.models = { ...geminiModels }
		}
	}
	// kilocode_change end

	async *createMessage(
		systemInstruction: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.ensureModelsLoaded() // kilocode_change
		const { id: model, info, reasoning: thinkingConfig, maxTokens } = this.getModel()
		// Reset per-request metadata that we persist into apiConversationHistory.
		this.lastThoughtSignature = undefined
		this.lastResponseId = undefined

		// For hybrid/budget reasoning models (e.g. Gemini 2.5 Pro), respect user-configured
		// modelMaxTokens so the ThinkingBudget slider can control the cap. For effort-only or
		// standard models (like gemini-3-pro-preview), ignore any stale modelMaxTokens and
		// default to the model's computed maxTokens from getModelMaxOutputTokens.
		const isHybridReasoningModel = info.supportsReasoningBudget || info.requiredReasoningBudget
		const maxOutputTokens = isHybridReasoningModel
			? (this.options.modelMaxTokens ?? maxTokens ?? undefined)
			: (maxTokens ?? undefined)

		// Only forward encrypted reasoning continuations (thoughtSignature) when we are
		// using reasoning (thinkingConfig is present). Both effort-based (thinkingLevel)
		// and budget-based (thinkingBudget) models require this for active loops.
		const includeThoughtSignatures = Boolean(thinkingConfig)

		// The message list can include provider-specific meta entries such as
		// `{ type: "reasoning", ... }` that are intended only for providers like
		// openai-native. Gemini should never see those; they are not valid
		// Anthropic.MessageParam values and will cause failures (e.g. missing
		// `content` for the converter). Filter them out here.
		type ReasoningMetaLike = { type?: string }

		const geminiMessages = messages.filter((message): message is Anthropic.Messages.MessageParam => {
			const meta = message as ReasoningMetaLike
			if (meta.type === "reasoning") {
				return false
			}
			return true
		})

		// Build a map of tool IDs to names from previous messages
		// This is needed because Anthropic's tool_result blocks only contain the ID,
		// but Gemini requires the name in functionResponse
		const toolIdToName = new Map<string, string>()
		for (const message of messages) {
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "tool_use") {
						toolIdToName.set(block.id, block.name)
					}
				}
			}
		}

		const contents = geminiMessages
			.map((message) => convertAnthropicMessageToGemini(message, { includeThoughtSignatures, toolIdToName }))
			.flat()

		const tools: GenerateContentConfig["tools"] = []

		// Google built-in tools (Grounding, URL Context) are currently mutually exclusive
		// with function declarations in the Gemini API. If native function calling is
		// used (Agent tools), we must prioritize it and skip built-in tools to avoid
		// "Tool use with function calling is unsupported" (HTTP 400) errors.
		if (metadata?.tools && metadata.tools.length > 0) {
			tools.push({
				functionDeclarations: metadata.tools.map((tool) => ({
					name: (tool as any).function.name,
					description: (tool as any).function.description,
					parametersJsonSchema: (tool as any).function.parameters,
				})),
			})
		} else {
			if (this.options.enableUrlContext) {
				tools.push({ urlContext: {} })
			}

			if (this.options.enableGrounding) {
				tools.push({ googleSearch: {} })
			}
		}

		// Determine temperature respecting model capabilities and defaults:
		// - If supportsTemperature is explicitly false, ignore user overrides
		//   and pin to the model's defaultTemperature (or omit if undefined).
		// - Otherwise, allow the user setting to override, falling back to model default,
		//   then to 1 for Gemini provider default.
		const supportsTemperature = info.supportsTemperature !== false
		const temperatureConfig: number | undefined = supportsTemperature
			? (this.options.modelTemperature ?? info.defaultTemperature ?? 1)
			: info.defaultTemperature

		const config: GenerateContentConfig = {
			systemInstruction,
			httpOptions: this.options.googleGeminiBaseUrl ? { baseUrl: this.options.googleGeminiBaseUrl } : undefined,
			thinkingConfig,
			maxOutputTokens,
			temperature: temperatureConfig,
			...(tools.length > 0 ? { tools } : {}),
		}

		if (metadata?.tool_choice) {
			const choice = metadata.tool_choice
			let mode: FunctionCallingConfigMode
			let allowedFunctionNames: string[] | undefined

			if (choice === "auto") {
				mode = FunctionCallingConfigMode.AUTO
			} else if (choice === "none") {
				mode = FunctionCallingConfigMode.NONE
			} else if (choice === "required") {
				// "required" means the model must call at least one tool; Gemini uses ANY for this.
				mode = FunctionCallingConfigMode.ANY
			} else if (typeof choice === "object" && "function" in choice && choice.type === "function") {
				mode = FunctionCallingConfigMode.ANY
				allowedFunctionNames = [choice.function.name]
			} else {
				// Fall back to AUTO for unknown values to avoid unintentionally broadening tool access.
				mode = FunctionCallingConfigMode.AUTO
			}

			config.toolConfig = {
				functionCallingConfig: {
					mode,
					...(allowedFunctionNames ? { allowedFunctionNames } : {}),
				},
			}
		}

		const params: GenerateContentParameters = { model, contents, config }

		try {
			const result = await this.client.models.generateContentStream(params)

			let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined
			let pendingGroundingMetadata: GroundingMetadata | undefined
			let finalResponse: { responseId?: string } | undefined
			let finishReason: string | undefined

			let toolCallCounter = 0
			let hasContent = false
			let hasReasoning = false

			for await (const chunk of result) {
				// Track the final structured response (per SDK pattern: candidate.finishReason)
				if (chunk.candidates && chunk.candidates[0]?.finishReason) {
					finalResponse = chunk as { responseId?: string }
					finishReason = chunk.candidates[0].finishReason
				}
				// Process candidates and their parts to separate thoughts from content
				if (chunk.candidates && chunk.candidates.length > 0) {
					const candidate = chunk.candidates[0]

					// kilocode_change start
					if (candidate.finishReason === FinishReason.MAX_TOKENS) {
						throwMaxCompletionTokensReachedError()
					}
					// kilocode_change end

					if (candidate.groundingMetadata) {
						pendingGroundingMetadata = candidate.groundingMetadata
					}

					if (candidate.content && candidate.content.parts) {
						for (const part of candidate.content.parts as Array<{
							thought?: boolean
							text?: string
							thoughtSignature?: string
							functionCall?: { name: string; args: Record<string, unknown> }
						}>) {
							// Capture thought signatures so they can be persisted into API history.
							const thoughtSignature = part.thoughtSignature
							// Persist encrypted reasoning when using reasoning. Both effort-based
							// and budget-based models require this for active loops.
							if (thinkingConfig && thoughtSignature) {
								this.lastThoughtSignature = thoughtSignature
							}

							if (part.thought) {
								// This is a thinking/reasoning part
								if (part.text) {
									hasReasoning = true
									yield { type: "reasoning", text: part.text }
								}
							} else if (part.functionCall) {
								hasContent = true
								// Gemini sends complete function calls in a single chunk
								// Emit as partial chunks for consistent handling with NativeToolCallParser
								const callId = `${part.functionCall.name}-${toolCallCounter}`
								const args = JSON.stringify(part.functionCall.args)

								// Emit name first
								yield {
									type: "tool_call_partial",
									index: toolCallCounter,
									id: callId,
									name: part.functionCall.name,
									arguments: undefined,
								}

								// Then emit arguments
								yield {
									type: "tool_call_partial",
									index: toolCallCounter,
									id: callId,
									name: undefined,
									arguments: args,
								}

								toolCallCounter++
							} else {
								// This is regular content
								if (part.text) {
									hasContent = true
									yield { type: "text", text: part.text }
								}
							}
						}
					}
				}

				// Fallback to the original text property if no candidates structure
				else if (chunk.text) {
					hasContent = true
					yield { type: "text", text: chunk.text }
				}

				if (chunk.usageMetadata) {
					lastUsageMetadata = chunk.usageMetadata
				}
			}

			// If we had reasoning but no content, emit a placeholder text to prevent "Empty assistant response" errors.
			// This typically happens when the model hits max output tokens while reasoning.
			if (hasReasoning && !hasContent) {
				let message = t("common:errors.gemini.thinking_complete_no_output")
				if (finishReason === "MAX_TOKENS") {
					message = t("common:errors.gemini.thinking_complete_truncated")
				} else if (finishReason === "SAFETY") {
					message = t("common:errors.gemini.thinking_complete_safety")
				} else if (finishReason === "RECITATION") {
					message = t("common:errors.gemini.thinking_complete_recitation")
				}

				yield { type: "text", text: message }
			}

			if (finalResponse?.responseId) {
				// Capture responseId so Task.addToApiConversationHistory can store it
				// alongside the assistant message in api_history.json.
				this.lastResponseId = finalResponse.responseId
			}

			if (pendingGroundingMetadata) {
				const sources = this.extractGroundingSources(pendingGroundingMetadata)
				if (sources.length > 0) {
					yield { type: "grounding", sources }
				}
			}

			if (lastUsageMetadata) {
				const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
				const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
				const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
				const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					cacheReadTokens,
					reasoningTokens,
					totalCost: this.calculateCost({
						info,
						inputTokens,
						outputTokens,
						cacheReadTokens,
						reasoningTokens,
					}),
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.gemini.generate_stream", { error: error.message }))
			}

			throw error
		}
	}

	override getModel() {
		// kilocode_change start: dynamic loading
		const requestedId = this.options.apiModelId
		const availableModels = this.models
		const staticModels = geminiModels as Record<string, ModelInfo>

		const id = requestedId && requestedId in availableModels ? requestedId : geminiDefaultModelId

		const info: ModelInfo =
			availableModels[id] ??
			staticModels[id] ??
			availableModels[geminiDefaultModelId] ??
			staticModels[geminiDefaultModelId]

		const params = getModelParams({
			format: "gemini",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: info.defaultTemperature ?? 1,
		})

		const apiModelId = id.endsWith(":thinking") ? id.replace(":thinking", "") : id

		return { id: apiModelId, info, ...params }
		// kilocode_change end
	}

	private extractGroundingSources(groundingMetadata?: GroundingMetadata): GroundingSource[] {
		const chunks = groundingMetadata?.groundingChunks

		if (!chunks) {
			return []
		}

		return chunks
			.map((chunk): GroundingSource | null => {
				const uri = chunk.web?.uri
				const title = chunk.web?.title || uri || "Unknown Source"

				if (uri) {
					return {
						title,
						url: uri,
					}
				}
				return null
			})
			.filter((source): source is GroundingSource => source !== null)
	}

	private extractCitationsOnly(groundingMetadata?: GroundingMetadata): string | null {
		const sources = this.extractGroundingSources(groundingMetadata)

		if (sources.length === 0) {
			return null
		}

		const citationLinks = sources.map((source, i) => `[${i + 1}](${source.url})`)
		return citationLinks.join(", ")
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			await this.ensureModelsLoaded() // kilocode_change
			const { id: model, info } = this.getModel()

			const tools: GenerateContentConfig["tools"] = []
			if (this.options.enableUrlContext) {
				tools.push({ urlContext: {} })
			}
			if (this.options.enableGrounding) {
				tools.push({ googleSearch: {} })
			}

			const supportsTemperature = info.supportsTemperature !== false
			const temperatureConfig: number | undefined = supportsTemperature
				? (this.options.modelTemperature ?? info.defaultTemperature ?? 1)
				: info.defaultTemperature

			const promptConfig: GenerateContentConfig = {
				httpOptions: this.options.googleGeminiBaseUrl
					? { baseUrl: this.options.googleGeminiBaseUrl }
					: undefined,
				temperature: temperatureConfig,
				...(tools.length > 0 ? { tools } : {}),
			}

			const request = {
				model,
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				config: promptConfig,
			}

			const result = await this.client.models.generateContent(request)

			let text = result.text ?? ""

			const candidate = result.candidates?.[0]
			if (candidate?.groundingMetadata) {
				const citations = this.extractCitationsOnly(candidate.groundingMetadata)
				if (citations) {
					text += `\n\n${t("common:errors.gemini.sources")} ${citations}`
				}
			}

			return text
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.gemini.generate_complete_prompt", { error: error.message }))
			}

			throw error
		}
	}

	public getThoughtSignature(): string | undefined {
		return this.lastThoughtSignature
	}

	public getResponseId(): string | undefined {
		return this.lastResponseId
	}

	public calculateCost({
		info,
		inputTokens,
		outputTokens,
		cacheReadTokens = 0,
		reasoningTokens = 0,
	}: {
		info: ModelInfo
		inputTokens: number
		outputTokens: number
		cacheReadTokens?: number
		reasoningTokens?: number
	}) {
		// For models with tiered pricing, prices might only be defined in tiers
		let inputPrice = info.inputPrice
		let outputPrice = info.outputPrice
		let cacheReadsPrice = info.cacheReadsPrice

		// If there's tiered pricing then adjust the input and output token prices
		// based on the input tokens used.
		if (info.tiers) {
			const tier = info.tiers.find((tier) => inputTokens <= tier.contextWindow)

			if (tier) {
				inputPrice = tier.inputPrice ?? inputPrice
				outputPrice = tier.outputPrice ?? outputPrice
				cacheReadsPrice = tier.cacheReadsPrice ?? cacheReadsPrice
			}
		}

		// Check if we have the required prices after considering tiers
		if (!inputPrice || !outputPrice) {
			return undefined
		}

		// cacheReadsPrice is optional - if not defined, treat as 0
		if (!cacheReadsPrice) {
			cacheReadsPrice = 0
		}

		// Subtract the cached input tokens from the total input tokens.
		const uncachedInputTokens = inputTokens - cacheReadTokens

		// Bill both completion and reasoning ("thoughts") tokens as output.
		const billedOutputTokens = outputTokens + reasoningTokens

		let cacheReadCost = cacheReadTokens > 0 ? cacheReadsPrice * (cacheReadTokens / 1_000_000) : 0

		const inputTokensCost = inputPrice * (uncachedInputTokens / 1_000_000)
		const outputTokensCost = outputPrice * (billedOutputTokens / 1_000_000)
		const totalCost = inputTokensCost + outputTokensCost + cacheReadCost

		const trace: Record<string, { price: number; tokens: number; cost: number }> = {
			input: { price: inputPrice, tokens: uncachedInputTokens, cost: inputTokensCost },
			output: { price: outputPrice, tokens: billedOutputTokens, cost: outputTokensCost },
		}

		if (cacheReadTokens > 0) {
			trace.cacheRead = { price: cacheReadsPrice, tokens: cacheReadTokens, cost: cacheReadCost }
		}

		return totalCost
	}
}
