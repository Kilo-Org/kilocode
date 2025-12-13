import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerCreateMessageMetadata } from "../../index"
import type { ApiStream, ApiStreamUsageChunk } from "../../transform/stream"
import { handleOpenAIError } from "./openai-error-handler"

/**
 * Controls which OpenAI endpoint style should be used for a given provider configuration.
 * - "off": Always use Chat Completions API
 * - "auto": Use Responses API only when the model requires it (e.g., Codex models) and baseUrl supports it
 * - "force": Always use Responses API when baseUrl supports it
 */
export type OpenAiResponsesMode = "off" | "auto" | "force"

export function supportsResponsesApiForBaseUrl(baseUrl?: string): boolean {
	try {
		const host = new URL(baseUrl ?? "").host
		return (
			host === "api.openai.com" ||
			host.endsWith(".openai.azure.com") ||
			host.endsWith(".cognitiveservices.azure.com") ||
			host.endsWith(".services.ai.azure.com")
		)
	} catch {
		return false
	}
}

export function requiresResponsesApiForModel(modelId: string, modelInfo?: ModelInfo): boolean {
	if ((modelInfo as any)?.requiresResponsesApi === true) return true

	const id = modelId.toLowerCase()
	// Azure Foundry Codex models have moved to Responses API only
	const codexPattern = /\bgpt[\-\w\.]*codex[\-\w\.]*\b/ // kilocode_change
	return id.includes("-codex") || codexPattern.test(id)
}

/**
 * Baut einen einfachen Textinput aus Anthropic-Messages.
 * Wird für Azure Codex + Responses genutzt, um `input: "<text>"` zu senden
 * statt der komplexen Input-Array-Struktur.
 */
function buildTextInputFromAnthropic(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
	const parts: string[] = []

	if (systemPrompt?.trim()) {
		parts.push(systemPrompt.trim())
	}

	for (const msg of messages) {
		const role = (msg as any).role ?? "user"
		const content = (msg as any).content

		if (typeof content === "string") {
			parts.push(`${role}: ${content}`)
		} else if (Array.isArray(content)) {
			const textParts = content
				.filter((c) => c.type === "text" && typeof c.text === "string")
				.map((c: any) => c.text)
			if (textParts.length) {
				parts.push(`${role}: ${textParts.join("\n")}`)
			}
		}
	}

	return parts.join("\n\n")
}

/**
 * Converts Anthropic-style messages into OpenAI Responses API "input" items.
 * Closely mirrors the logic in OpenAI Native handler.
 */
export function buildResponsesInputFromAnthropic(messages: Anthropic.Messages.MessageParam[]): any[] {
	const formattedInput: any[] = []

	for (const message of messages) {
		// Pass through reasoning items as-is (some flows store them for stateless continuity)
		if ((message as any).type === "reasoning") {
			formattedInput.push(message)
			continue
		}

		// OpenAI Responses API examples expect a simple list of role/content objects:
		// input: [{ role: "user", content: "..." }, ...]
		// plus optional function_call_output items.
		if (message.role === "user") {
			let textContent = ""
			const toolResults: any[] = []

			if (typeof message.content === "string") {
				textContent = message.content
			} else if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "text") {
						textContent += (textContent ? "\n" : "") + block.text
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
					// Image & andere Blocktypen werden für Responses vorerst ignoriert,
					// bis sie explizit benötigt werden.
				}
			}

			if (textContent) {
				formattedInput.push({ role: "user", content: textContent })
			}
			if (toolResults.length > 0) {
				formattedInput.push(...toolResults)
			}
			continue
		}

		if (message.role === "assistant") {
			let textContent = ""

			if (typeof message.content === "string") {
				textContent = message.content
			} else if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "text") {
						textContent += (textContent ? "\n" : "") + block.text
					}
					// Note: assistant tool_use blocks are not expected in this Anthropic param format here.
					// Tool calls are transmitted back to the model via function_call_output items (user side).
				}
			}

			if (textContent) {
				formattedInput.push({ role: "assistant", content: textContent })
			}
		}
	}

	return formattedInput
}

export function buildResponsesRequestBody({
	modelId,
	modelInfo,
	systemPrompt,
	messages,
	metadata,
	streaming,
	temperature,
	maxOutputTokens,
	useTextInput,
	store,
}: {
	modelId: string
	modelInfo: ModelInfo
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	metadata?: ApiHandlerCreateMessageMetadata
	streaming: boolean
	temperature?: number
	maxOutputTokens?: number
	useTextInput?: boolean
	store?: boolean
}): any {
	const input =
		useTextInput === true
			? buildTextInputFromAnthropic(systemPrompt, messages)
			: buildResponsesInputFromAnthropic(messages)

	const body: any = {
		model: modelId,
		instructions: systemPrompt,
		input,
		stream: streaming,
		// Endpoint erwartet hier einen bool: false = nichts speichern.
		// Per Setting konfigurierbar (Checkbox in den OpenAI-compatible Settings).
		store: store ?? false,
	}

	if (typeof temperature === "number" && modelInfo.supportsTemperature !== false) {
		body.temperature = temperature
	}

	if (typeof maxOutputTokens === "number" && maxOutputTokens > 0) {
		body.max_output_tokens = maxOutputTokens
	}

	if (metadata?.tools) {
		body.tools = metadata.tools.map((tool: any) => ({
			type: "function",
			function: tool,
		}))
	}

	if (metadata?.tool_choice) {
		body.tool_choice = metadata.tool_choice
	}

	if (metadata?.toolProtocol === "native") {
		body.parallel_tool_calls = metadata.parallelToolCalls ?? false
	}

	// Include text.verbosity only when the model explicitly supports it
	if ((modelInfo as any).supportsVerbosity === true) {
		body.text = { verbosity: "medium" }
	}

	return body
}

function normalizeResponsesUsageToApiStream(usage: any): ApiStreamUsageChunk | undefined {
	if (!usage) return undefined

	// Responses API usage shape varies by provider; accept multiple common shapes.
	const inputTokens =
		usage.input_tokens ??
		usage.prompt_tokens ??
		usage?.prompt_tokens_details?.input_tokens ??
		usage?.prompt_tokens ??
		0
	const outputTokens =
		usage.output_tokens ?? usage.completion_tokens ?? usage?.completion_tokens ?? usage?.output_tokens ?? 0
	const cacheReadTokens =
		usage?.prompt_tokens_details?.cached_tokens ??
		usage?.cache_read_input_tokens ??
		usage?.cache_read_tokens ??
		undefined
	const cacheWriteTokens =
		usage?.prompt_tokens_details?.cache_write_tokens ??
		usage?.cache_creation_input_tokens ??
		usage?.cache_write_tokens ??
		undefined

	return {
		type: "usage",
		inputTokens: inputTokens || 0,
		outputTokens: outputTokens || 0,
		cacheReadTokens: cacheReadTokens || undefined,
		cacheWriteTokens: cacheWriteTokens || undefined,
	}
}

/**
 * Streams a Responses API request into Kilocode ApiStream chunks.
 *
 * Note: We keep this intentionally conservative and focus on the core event types
 * needed for text, reasoning and tool calls. This is sufficient to unlock Codex/Foundry models.
 */
export async function* streamResponsesAsApiStream({
	client,
	requestBody,
	providerName,
	requestOptions,
}: {
	client: any
	requestBody: any
	providerName: string
	requestOptions?: OpenAI.RequestOptions
}): ApiStream {
	let stream: AsyncIterable<any>

	try {
		// Path / Host-spezifische Logik wird ausschließlich im aufrufenden OpenAiHandler gesetzt.
		// Der Adapter reicht requestOptions unverändert durch, um Typfehler mit baseURL zu vermeiden.
		stream = (await client.responses.create(requestBody, requestOptions)) as AsyncIterable<any>
	} catch (error) {
		throw handleOpenAIError(error, providerName)
	}

	if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
		throw new Error(`${providerName} Responses API did not return an AsyncIterable`)
	}

	for await (const event of stream) {
		// Text deltas
		if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
			yield { type: "text", text: event.delta }
			continue
		}

		// Reasoning deltas (best-effort)
		if (event?.type === "response.reasoning.delta" && typeof event.delta === "string") {
			yield { type: "reasoning", text: event.delta }
			continue
		}

		// Tool call argument deltas (best-effort, mirrors OpenAI Native parsing surface)
		if (event?.type === "response.function_call.delta") {
			yield {
				type: "tool_call_partial",
				index: event.index ?? 0,
				id: event.call_id,
				name: event.name,
				arguments: event.arguments,
			}
			continue
		}

		// Final message snapshot sometimes contains accumulated output
		if (event?.type === "response.output_text.done" && typeof event.text === "string") {
			yield { type: "text", text: event.text }
			continue
		}

		// Usage
		if (event?.type === "response.completed") {
			const usageChunk = normalizeResponsesUsageToApiStream(event.response?.usage ?? event.usage)
			if (usageChunk) yield usageChunk
			continue
		}
	}
}

export async function completePromptViaResponses({
	client,
	requestBody,
	providerName,
	requestOptions,
}: {
	client: any
	requestBody: any
	providerName: string
	requestOptions?: OpenAI.RequestOptions
}): Promise<string> {
	let response: any
	try {
		response = await client.responses.create(requestBody, requestOptions)
	} catch (error) {
		throw handleOpenAIError(error, providerName)
	}

	// Extract text from the response.output array if present
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

	// Fallback: check for direct text in response
	if (typeof response?.text === "string") {
		return response.text
	}

	return ""
}
