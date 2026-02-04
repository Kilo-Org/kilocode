/**
 * AI SDK conversion utilities for transforming between Anthropic/OpenAI formats and Vercel AI SDK formats.
 * These utilities are designed to be reused across different AI SDK providers.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { tool as createTool, jsonSchema, type ModelMessage, type TextStreamPart } from "ai"
import type { ApiStreamChunk } from "./stream"

/**
 * Options for converting Anthropic messages to AI SDK format.
 */
export interface ConvertToAiSdkMessagesOptions {
	/**
	 * Optional function to transform the converted messages.
	 * Useful for transformations like flattening message content for models that require string content.
	 */
	transform?: (messages: ModelMessage[]) => ModelMessage[]
}

/**
 * Convert Anthropic messages to AI SDK ModelMessage format.
 * Handles text, images, tool uses, and tool results.
 *
 * @param messages - Array of Anthropic message parameters
 * @param options - Optional conversion options including post-processing function
 * @returns Array of AI SDK ModelMessage objects
 */
export function convertToAiSdkMessages(
	messages: Anthropic.Messages.MessageParam[],
	options?: ConvertToAiSdkMessagesOptions,
): ModelMessage[] {
	const modelMessages: ModelMessage[] = []

	// First pass: build a map of tool call IDs to tool names from assistant messages
	const toolCallIdToName = new Map<string, string>()
	for (const message of messages) {
		if (message.role === "assistant" && typeof message.content !== "string") {
			for (const part of message.content) {
				if (part.type === "tool_use") {
					toolCallIdToName.set(part.id, part.name)
				}
			}
		}
	}

	for (const message of messages) {
		if (typeof message.content === "string") {
			modelMessages.push({
				role: message.role,
				content: message.content,
			})
		} else {
			if (message.role === "user") {
				const parts: Array<
					{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }
				> = []
				const toolResults: Array<{
					type: "tool-result"
					toolCallId: string
					toolName: string
					output: { type: "text"; value: string }
				}> = []

				for (const part of message.content) {
					if (part.type === "text") {
						parts.push({ type: "text", text: part.text })
					} else if (part.type === "image") {
						// Handle both base64 and URL source types
						const source = part.source as { type: string; media_type?: string; data?: string; url?: string }
						if (source.type === "base64" && source.media_type && source.data) {
							parts.push({
								type: "image",
								image: `data:${source.media_type};base64,${source.data}`,
								mimeType: source.media_type,
							})
						} else if (source.type === "url" && source.url) {
							parts.push({
								type: "image",
								image: source.url,
							})
						}
					} else if (part.type === "tool_result") {
						// Convert tool results to string content
						let content: string
						if (typeof part.content === "string") {
							content = part.content
						} else {
							content =
								part.content
									?.map((c) => {
										if (c.type === "text") return c.text
										if (c.type === "image") return "(image)"
										return ""
									})
									.join("\n") ?? ""
						}
						// Look up the tool name from the tool call ID
						const toolName = toolCallIdToName.get(part.tool_use_id) ?? "unknown_tool"
						toolResults.push({
							type: "tool-result",
							toolCallId: part.tool_use_id,
							toolName,
							output: { type: "text", value: content || "(empty)" },
						})
					}
				}

				// AI SDK requires tool results in separate "tool" role messages
				// UserContent only supports: string | Array<TextPart | ImagePart | FilePart>
				// ToolContent (for role: "tool") supports: Array<ToolResultPart | ToolApprovalResponse>
				if (toolResults.length > 0) {
					modelMessages.push({
						role: "tool",
						content: toolResults,
					} as ModelMessage)
				}

				// Add user message with only text/image content (no tool results)
				if (parts.length > 0) {
					modelMessages.push({
						role: "user",
						content: parts,
					} as ModelMessage)
				}
			} else if (message.role === "assistant") {
				const textParts: string[] = []
				const toolCalls: Array<{
					type: "tool-call"
					toolCallId: string
					toolName: string
					input: unknown
				}> = []

				for (const part of message.content) {
					if (part.type === "text") {
						textParts.push(part.text)
					} else if (part.type === "tool_use") {
						toolCalls.push({
							type: "tool-call",
							toolCallId: part.id,
							toolName: part.name,
							input: part.input,
						})
					}
				}

				const content: Array<
					| { type: "text"; text: string }
					| { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
				> = []

				if (textParts.length > 0) {
					content.push({ type: "text", text: textParts.join("\n") })
				}
				content.push(...toolCalls)

				modelMessages.push({
					role: "assistant",
					content: content.length > 0 ? content : [{ type: "text", text: "" }],
				} as ModelMessage)
			}
		}
	}

	// Apply transform if provided
	if (options?.transform) {
		return options.transform(modelMessages)
	}

	return modelMessages
}

/**
 * Options for flattening AI SDK messages.
 */
export interface FlattenMessagesOptions {
	/**
	 * If true, flattens user messages with only text parts to string content.
	 * Default: true
	 */
	flattenUserMessages?: boolean
	/**
	 * If true, flattens assistant messages with only text (no tool calls) to string content.
	 * Default: true
	 */
	flattenAssistantMessages?: boolean
}

/**
 * Flatten AI SDK messages to use string content where possible.
 * Some models (like DeepSeek on SambaNova) require string content instead of array content.
 * This function converts messages that contain only text parts to use simple string content.
 *
 * @param messages - Array of AI SDK ModelMessage objects
 * @param options - Options for controlling which message types to flatten
 * @returns Array of AI SDK ModelMessage objects with flattened content where applicable
 */
export function flattenAiSdkMessagesToStringContent(
	messages: ModelMessage[],
	options: FlattenMessagesOptions = {},
): ModelMessage[] {
	const { flattenUserMessages = true, flattenAssistantMessages = true } = options

	return messages.map((message) => {
		// Skip if content is already a string
		if (typeof message.content === "string") {
			return message
		}

		// Handle user messages
		if (message.role === "user" && flattenUserMessages && Array.isArray(message.content)) {
			const parts = message.content as Array<{ type: string; text?: string }>
			// Only flatten if all parts are text
			const allText = parts.every((part) => part.type === "text")
			if (allText && parts.length > 0) {
				const textContent = parts.map((part) => part.text || "").join("\n")
				return {
					...message,
					content: textContent,
				}
			}
		}

		// Handle assistant messages
		if (message.role === "assistant" && flattenAssistantMessages && Array.isArray(message.content)) {
			const parts = message.content as Array<{ type: string; text?: string }>
			// Only flatten if all parts are text (no tool calls)
			const allText = parts.every((part) => part.type === "text")
			if (allText && parts.length > 0) {
				const textContent = parts.map((part) => part.text || "").join("\n")
				return {
					...message,
					content: textContent,
				}
			}
		}

		// Return unchanged for tool role and messages with non-text content
		return message
	})
}

/**
 * Convert OpenAI-style function tool definitions to AI SDK tool format.
 *
 * @param tools - Array of OpenAI tool definitions
 * @returns Record of AI SDK tools keyed by tool name, or undefined if no tools
 */
export function convertToolsForAiSdk(
	tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
): Record<string, ReturnType<typeof createTool>> | undefined {
	if (!tools || tools.length === 0) {
		return undefined
	}

	const toolSet: Record<string, ReturnType<typeof createTool>> = {}

	for (const t of tools) {
		if (t.type === "function") {
			toolSet[t.function.name] = createTool({
				description: t.function.description,
				inputSchema: jsonSchema(t.function.parameters as any),
			})
		}
	}

	return toolSet
}

/**
 * Extended stream part type that includes additional fullStream event types
 * that are emitted at runtime but not included in the AI SDK TextStreamPart type definitions.
 */
type ExtendedStreamPart = TextStreamPart<any> | { type: "text"; text: string } | { type: "reasoning"; text: string }

/**
 * Process a single AI SDK stream part and yield the appropriate ApiStreamChunk(s).
 * This generator handles all TextStreamPart types and converts them to the
 * ApiStreamChunk format used by the application.
 *
 * @param part - The AI SDK TextStreamPart to process (including fullStream event types)
 * @yields ApiStreamChunk objects corresponding to the stream part
 */
export function* processAiSdkStreamPart(part: ExtendedStreamPart): Generator<ApiStreamChunk> {
	switch (part.type) {
		case "text":
		case "text-delta":
			yield { type: "text", text: (part as { text: string }).text }
			break

		case "reasoning":
		case "reasoning-delta":
			yield { type: "reasoning", text: (part as { text: string }).text }
			break

		case "tool-input-start":
			yield {
				type: "tool_call_start",
				id: part.id,
				name: part.toolName,
			}
			break

		case "tool-input-delta":
			yield {
				type: "tool_call_delta",
				id: part.id,
				delta: part.delta,
			}
			break

		case "tool-input-end":
			yield {
				type: "tool_call_end",
				id: part.id,
			}
			break

		case "source":
			// Handle both URL and document source types
			if ("url" in part) {
				yield {
					type: "grounding",
					sources: [
						{
							title: part.title || "Source",
							url: part.url,
							snippet: undefined,
						},
					],
				}
			}
			break

		case "error":
			yield {
				type: "error",
				error: "StreamError",
				message: part.error instanceof Error ? part.error.message : String(part.error),
			}
			break

		// Ignore lifecycle events that don't need to yield chunks.
		// Note: tool-call is intentionally ignored because tool-input-start/delta/end already
		// provide complete tool call information. Emitting tool-call would cause duplicate
		// tools in the UI for AI SDK providers (e.g., DeepSeek, Moonshot).
		case "text-start":
		case "text-end":
		case "reasoning-start":
		case "reasoning-end":
		case "start-step":
		case "finish-step":
		case "start":
		case "finish":
		case "abort":
		case "file":
		case "tool-result":
		case "tool-error":
		case "tool-call":
		case "raw":
			break
	}
}

/**
 * Type for AI SDK tool choice format.
 */
export type AiSdkToolChoice = "auto" | "none" | "required" | { type: "tool"; toolName: string } | undefined

/**
 * Map OpenAI-style tool_choice to AI SDK toolChoice format.
 * This is a shared utility to avoid duplication across providers.
 *
 * @param toolChoice - OpenAI-style tool choice (string or object)
 * @returns AI SDK toolChoice format
 */
export function mapToolChoice(toolChoice: any): AiSdkToolChoice {
	if (!toolChoice) {
		return undefined
	}

	// Handle string values
	if (typeof toolChoice === "string") {
		switch (toolChoice) {
			case "auto":
				return "auto"
			case "none":
				return "none"
			case "required":
				return "required"
			default:
				return "auto"
		}
	}

	// Handle object values (OpenAI ChatCompletionNamedToolChoice format)
	if (typeof toolChoice === "object" && "type" in toolChoice) {
		if (toolChoice.type === "function" && "function" in toolChoice && toolChoice.function?.name) {
			return { type: "tool", toolName: toolChoice.function.name }
		}
	}

	return undefined
}

/**
 * Extract a user-friendly error message from AI SDK errors.
 * The AI SDK wraps errors in types like AI_RetryError and AI_APICallError
 * which need to be unwrapped to get the actual error message.
 *
 * @param error - The error to extract the message from
 * @returns A user-friendly error message
 */
export function extractAiSdkErrorMessage(error: unknown): string {
	if (!error) {
		return "Unknown error"
	}

	// Cast to access AI SDK error properties
	const anyError = error as any

	// AI_RetryError has a lastError property with the actual error
	if (anyError.name === "AI_RetryError") {
		const retryCount = anyError.errors?.length || 0
		const lastError = anyError.lastError
		const lastErrorMessage = lastError?.message || lastError?.toString() || "Unknown error"

		// Extract status code if available
		const statusCode =
			lastError?.status || lastError?.statusCode || anyError.status || anyError.statusCode || undefined

		if (statusCode) {
			return `Failed after ${retryCount} attempts (${statusCode}): ${lastErrorMessage}`
		}
		return `Failed after ${retryCount} attempts: ${lastErrorMessage}`
	}

	// AI_APICallError has message and optional status
	if (anyError.name === "AI_APICallError") {
		const statusCode = anyError.status || anyError.statusCode
		if (statusCode) {
			return `API Error (${statusCode}): ${anyError.message}`
		}
		return anyError.message || "API call failed"
	}

	// Standard Error
	if (error instanceof Error) {
		return error.message
	}

	// Fallback for non-Error objects
	return String(error)
}

/**
 * Handle AI SDK errors by extracting the message and preserving status codes.
 * Returns an Error object with proper status preserved for retry logic.
 *
 * @param error - The AI SDK error to handle
 * @param providerName - The name of the provider for context
 * @returns An Error with preserved status code
 */
export function handleAiSdkError(error: unknown, providerName: string): Error {
	const message = extractAiSdkErrorMessage(error)
	const wrappedError = new Error(`${providerName}: ${message}`)

	// Preserve status code for retry logic
	const anyError = error as any
	const statusCode =
		anyError?.lastError?.status ||
		anyError?.lastError?.statusCode ||
		anyError?.status ||
		anyError?.statusCode ||
		undefined

	if (statusCode) {
		;(wrappedError as any).status = statusCode
	}

	// Preserve the original error for debugging
	;(wrappedError as any).cause = error

	return wrappedError
}
