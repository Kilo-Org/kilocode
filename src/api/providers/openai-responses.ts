// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	NATIVE_TOOL_DEFAULTS,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { calculateApiCostOpenAI } from "../../shared/cost"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { normalizeObjectAdditionalPropertiesFalse } from "./kilocode/openai-strict-schema" // kilocode_change
import { isMcpTool } from "../../utils/mcp-name"

export type OpenAiResponsesModel = ReturnType<OpenAiCompatibleResponsesHandler["getModel"]>

export class OpenAiCompatibleResponsesHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "OpenAI Compatible (Responses)"
	private abortController?: AbortController
	private readonly toolCallIdentityById = new Map<string, { id: string; name: string }>()
	private readonly isAzureAiInferenceEndpoint: boolean
	private readonly isAzureOpenAiEndpoint: boolean

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		if (this.options.enableResponsesReasoningSummary === undefined) {
			this.options.enableResponsesReasoningSummary = true
		}

		const baseURL = this.options.openAiBaseUrl ?? "https://api.openai.com/v1"
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const timeout = getApiRequestTimeout()
		const urlHost = this._getUrlHost(this.options.openAiBaseUrl)
		this.isAzureAiInferenceEndpoint = this._isAzureAiInference(this.options.openAiBaseUrl)
		this.isAzureOpenAiEndpoint =
			urlHost === "azure.com" || urlHost.endsWith(".azure.com") || !!options.openAiUseAzure

		if (this.isAzureOpenAiEndpoint) {
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: this.options.openAiHeaders || {},
				timeout,
			})
		} else {
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: this.options.openAiHeaders || {},
				timeout,
			})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// kilocode_change start
		this.assertSupportedResponsesEndpoint()
		// kilocode_change end
		const model = this.getModel()
		yield* this.handleResponsesApiMessage(model, systemPrompt, messages, metadata)
	}

	private async *handleResponsesApiMessage(
		model: OpenAiResponsesModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { verbosity } = model

		const formattedInput = this.formatFullConversation(systemPrompt, messages)
		const requestBody = this.buildRequestBody(model, formattedInput, systemPrompt, verbosity, metadata)

		yield* this.executeRequest(requestBody)
	}

	private buildRequestBody(
		model: OpenAiResponsesModel,
		formattedInput: any,
		systemPrompt: string,
		verbosity: any,
		metadata?: ApiHandlerCreateMessageMetadata,
	): any {
		interface ResponsesRequestBody {
			model: string
			input: Array<{ role: "user" | "assistant"; content: any[] } | { type: string; content: string }>
			stream: boolean
			reasoning?: { summary?: "auto" }
			text?: { verbosity: string }
			temperature?: number
			max_output_tokens?: number
			store?: boolean
			instructions?: string
			include?: string[]
			tools?: Array<{
				type: "function"
				name: string
				description?: string
				parameters?: any
				strict?: boolean
			}>
			tool_choice?: any
			parallel_tool_calls?: boolean
		}

		const body: ResponsesRequestBody = {
			model: model.id,
			input: formattedInput,
			stream: true,
			store: false,
			instructions: systemPrompt,
			...(this.options.enableResponsesReasoningSummary ? { reasoning: { summary: "auto" as const } } : {}),
			...(model.info.supportsTemperature !== false &&
				typeof this.options.modelTemperature === "number" && {
					temperature: this.options.modelTemperature,
				}),
			...(model.maxTokens && this.options.includeMaxTokens ? { max_output_tokens: model.maxTokens } : {}),
			...(metadata?.tools && {
				tools: metadata.tools
					.filter((tool) => tool.type === "function")
					.map((tool) => {
						const isMcp = isMcpTool(tool.function.name)
						return {
							type: "function",
							name: tool.function.name,
							description: tool.function.description,
							parameters: isMcp
								? normalizeObjectAdditionalPropertiesFalse(tool.function.parameters)
								: this.convertToolSchemaForOpenAI(tool.function.parameters),
							strict: !isMcp,
						}
					}),
			}),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
		}

		if (metadata?.toolProtocol === "native") {
			body.parallel_tool_calls = metadata.parallelToolCalls ?? false
		}

		if (model.info.supportsVerbosity === true) {
			body.text = { verbosity: (verbosity || "medium") as string }
		}

		return body
	}

	private async *executeRequest(requestBody: any): ApiStream {
		this.abortController = new AbortController()

		try {
			const stream = (await (this.client as any).responses.create(requestBody, {
				signal: this.abortController.signal,
			})) as AsyncIterable<any>

			if (typeof (stream as any)[Symbol.asyncIterator] !== "function") {
				throw new Error(
					"OpenAI SDK did not return an AsyncIterable for Responses API streaming. Falling back to SSE.",
				)
			}

			for await (const event of stream) {
				if (this.abortController.signal.aborted) {
					break
				}

				for await (const outChunk of this.processEvent(event)) {
					yield outChunk
				}
			}
		} catch (_sdkErr: any) {
			yield* this.makeResponsesApiRequest(requestBody)
		} finally {
			this.abortController = undefined
		}
	}

	private formatFullConversation(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): any {
		const formattedInput: any[] = []

		for (const message of messages) {
			if ((message as any).type === "reasoning") {
				formattedInput.push(message)
				continue
			}

			if (message.role === "user") {
				const content: any[] = []
				const toolResults: any[] = []

				if (typeof message.content === "string") {
					content.push({ type: "input_text", text: message.content })
				} else if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "text") {
							content.push({ type: "input_text", text: block.text })
						} else if (block.type === "image") {
							const image = block as Anthropic.Messages.ImageBlockParam
							let imageUrl: string
							if (image.source.type === "base64") {
								imageUrl = `data:${image.source.media_type};base64,${image.source.data}`
							} else {
								imageUrl = image.source.url
							}
							content.push({ type: "input_image", image_url: imageUrl })
						} else if (block.type === "tool_result") {
							const result =
								typeof block.content === "string"
									? block.content
									: block.content?.map((c) => (c.type === "text" ? c.text : "")).join("") || ""
							toolResults.push({
								type: "function_call_output",
								call_id: block.tool_use_id,
								output: result,
							})
						}
					}
				}

				if (content.length > 0) {
					formattedInput.push({ role: "user", content })
				}

				if (toolResults.length > 0) {
					formattedInput.push(...toolResults)
				}
			} else if (message.role === "assistant") {
				const content: any[] = []
				const toolCalls: any[] = []

				if (typeof message.content === "string") {
					content.push({ type: "output_text", text: message.content })
				} else if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "text") {
							content.push({ type: "output_text", text: block.text })
						} else if (block.type === "tool_use") {
							toolCalls.push({
								type: "function_call",
								call_id: block.id,
								name: block.name,
								arguments: JSON.stringify(block.input),
							})
						}
					}
				}

				if (content.length > 0) {
					formattedInput.push({ role: "assistant", content })
				}

				if (toolCalls.length > 0) {
					formattedInput.push(...toolCalls)
				}
			}
		}

		return formattedInput
	}

	private async *makeResponsesApiRequest(requestBody: any): ApiStream {
		// kilocode_change start
		this.assertSupportedResponsesEndpoint()
		// kilocode_change end
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const { url, headers } = this.getResponsesFallbackTarget(apiKey)

		this.abortController = new AbortController()

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					...headers,
				},
				body: JSON.stringify(requestBody),
				signal: this.abortController.signal,
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `OpenAI Responses API request failed (${response.status})`
				switch (response.status) {
					case 400:
						errorMessage = "Invalid request to Responses API. Please check your input parameters."
						break
					case 401:
						errorMessage = "Authentication failed. Please check your API key."
						break
					case 403:
						errorMessage = "Access denied. Your API key doesn't have access to this resource."
						break
					case 404:
						// kilocode_change start
						errorMessage = this.isAzureOpenAiEndpoint
							? "Responses API endpoint not found. For Azure OpenAI, use a base URL like https://<resource>.openai.azure.com/openai/v1 and set model to your deployment name."
							: "Responses API endpoint not found. The endpoint may not be available yet or requires a different configuration."
						if ((this.options.openAiBaseUrl || "").includes("/deployments/")) {
							errorMessage += " Do not use a /deployments/.../chat/completions URL as the base URL."
						}
						// kilocode_change end
						break
					case 429:
						errorMessage = "Rate limit exceeded. Please try again later."
						break
					case 500:
						errorMessage = "OpenAI server error. Please try again later."
						break
				}
				throw new Error(`${errorMessage} ${errorText}`)
			}

			if (!response.body) {
				throw new Error("Responses API error: No response body")
			}

			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ""

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue
					const data = line.slice(6).trim()
					if (data === "[DONE]") return
					try {
						const event = JSON.parse(data)
						for await (const outChunk of this.processEvent(event)) {
							yield outChunk
						}
					} catch (error) {
						continue
					}
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes("Responses API")) {
					throw error
				}
				throw new Error(`Failed to connect to Responses API: ${error.message}`)
			}
			throw new Error("Unexpected error connecting to Responses API")
		} finally {
			this.abortController = undefined
		}
	}

	private async *processEvent(event: any): ApiStream {
		const eventType = event?.type

		if (
			eventType === "response.text.delta" ||
			eventType === "response.output_text.delta" ||
			eventType === "response.output_text" ||
			eventType === "response.text"
		) {
			const text = event.delta || event.text || event?.content?.[0]?.text
			if (text) {
				yield { type: "text", text }
			}
			return
		}

		if (
			eventType === "response.reasoning.delta" ||
			eventType === "response.reasoning_text.delta" ||
			eventType === "response.reasoning_summary.delta" ||
			eventType === "response.reasoning_summary_text.delta"
		) {
			const text = event.delta || event.text
			if (text) {
				yield { type: "reasoning", text }
			}
			return
		}

		if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
			const item = event.item
			if (item?.type === "function_call") {
				if (item.call_id && item.name) {
					this.toolCallIdentityById.set(item.call_id, { id: item.call_id, name: item.name })
				}

				if (eventType === "response.output_item.done") {
					const args = typeof item.arguments === "string" ? item.arguments : undefined
					if (item.call_id && item.name && args) {
						yield {
							type: "tool_call",
							id: item.call_id,
							name: item.name,
							arguments: args,
						}
					}
				}
			}
			return
		}

		if (
			eventType === "response.tool_call_arguments.delta" ||
			eventType === "response.function_call_arguments.delta"
		) {
			const callId = event.call_id
			const cachedIdentity = callId ? this.toolCallIdentityById.get(callId) : undefined
			const resolvedId = event.call_id || cachedIdentity?.id
			const resolvedName = event.name || cachedIdentity?.name
			if (!resolvedId || !resolvedName) {
				return
			}
			yield {
				type: "tool_call_partial",
				index: 0,
				id: resolvedId,
				name: resolvedName,
				arguments: event.delta,
			}
			return
		}

		if (
			eventType === "response.tool_call_arguments.done" ||
			eventType === "response.function_call_arguments.done"
		) {
			if (event.call_id) {
				yield { type: "tool_call_end", id: event.call_id }
			}
			return
		}

		if (eventType === "response.completed" || eventType === "response.done") {
			const usage = event.response?.usage
			if (usage) {
				yield this.normalizeUsage(usage, this.getModel())
			}
			return
		}
	}

	private normalizeUsage(usage: any, model: OpenAiResponsesModel): ApiStreamUsageChunk {
		const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
		const cacheReadTokens = usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? 0
		const { totalCost } = calculateApiCostOpenAI(
			model.info,
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
		)

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost,
		}
	}

	override getModel() {
		const id = this.options.openAiModelId ?? ""
		const info: ModelInfo = {
			...NATIVE_TOOL_DEFAULTS,
			...(this.options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
		}
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		// kilocode_change start
		this.assertSupportedResponsesEndpoint()
		// kilocode_change end
		this.abortController = new AbortController()

		try {
			const model = this.getModel()
			const requestBody: any = {
				model: model.id,
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: prompt }],
					},
				],
				stream: false,
				store: false,
			}

			const response = await (this.client as any).responses.create(requestBody, {
				signal: this.abortController.signal,
			})

			if (response?.output && Array.isArray(response.output)) {
				for (const outputItem of response.output) {
					if (outputItem.type === "message" && outputItem.content) {
						for (const content of outputItem.content) {
							if (content.type === "output_text" && content.text) {
								return content.text
							}
						}
					}
				}
			}

			return ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} completion error: ${error.message}`)
			}

			throw error
		} finally {
			this.abortController = undefined
		}
	}

	// kilocode_change start
	private assertSupportedResponsesEndpoint(): void {
		if (this.isAzureAiInferenceEndpoint) {
			throw new Error(
				"Azure AI Inference endpoints (*.services.ai.azure.com) are not supported by OpenAI Compatible (Responses). Use an Azure OpenAI endpoint like https://<resource>.openai.azure.com/openai/v1 and set model to your deployment name.",
			)
		}
	}

	private getResponsesFallbackTarget(apiKey: string): { url: string; headers: Record<string, string> } {
		const normalizedBaseUrl = this.normalizeResponsesBaseUrl(this.options.openAiBaseUrl)
		const url = new URL(`${normalizedBaseUrl.replace(/\/+$/, "")}/responses`)
		const headers: Record<string, string> = {
			...(this.options.openAiHeaders || {}),
		}

		if (this.isAzureOpenAiEndpoint) {
			headers["api-key"] = apiKey
			if (this.shouldAppendAzureApiVersion(url) && !url.searchParams.has("api-version")) {
				url.searchParams.set("api-version", this.options.azureApiVersion || azureOpenAiDefaultApiVersion)
			}
		} else {
			headers.Authorization = `Bearer ${apiKey}`
		}

		return { url: url.toString(), headers }
	}

	private normalizeResponsesBaseUrl(baseUrl?: string): string {
		const defaultBaseUrl = this.isAzureOpenAiEndpoint
			? "https://api.openai.azure.com/openai/v1"
			: "https://api.openai.com/v1"

		if (!baseUrl) {
			return defaultBaseUrl
		}

		try {
			const parsed = new URL(baseUrl)
			parsed.search = ""
			parsed.hash = ""

			let pathname = parsed.pathname.replace(/\/+$/, "")
			pathname = pathname.replace(/\/(chat\/completions|completions|responses)$/, "")

			if (this.isAzureOpenAiEndpoint) {
				if (/\/openai\/deployments\/[^/]+$/.test(pathname)) {
					pathname = "/openai/v1"
				} else if (pathname === "" || pathname === "/") {
					pathname = "/openai/v1"
				} else if (pathname === "/v1") {
					pathname = "/openai/v1"
				} else if (pathname === "/openai") {
					pathname = "/openai/v1"
				} else if (pathname.endsWith("/openai")) {
					pathname = `${pathname}/v1`
				} else if (!pathname.endsWith("/v1")) {
					pathname = `${pathname}/v1`
				}
			} else {
				if (pathname === "" || pathname === "/") {
					pathname = "/v1"
				} else if (!pathname.endsWith("/v1")) {
					pathname = `${pathname}/v1`
				}
			}

			parsed.pathname = pathname
			return parsed.toString().replace(/\/$/, "")
		} catch {
			return defaultBaseUrl
		}
	}

	private shouldAppendAzureApiVersion(url: URL): boolean {
		const pathname = url.pathname.replace(/\/+$/, "")
		return !pathname.includes("/openai/v1")
	}
	// kilocode_change end

	protected _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").host
		} catch (error) {
			return ""
		}
	}

	protected _isAzureAiInference(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.endsWith(".services.ai.azure.com")
	}
}
