import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

/**
 * Type for OpenRouter's reasoning detail elements.
 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens#streaming-response
 */
export type ReasoningDetail = {
	/**
	 * Type of reasoning detail.
	 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens#reasoning-detail-types
	 */
	type: string // "reasoning.summary" | "reasoning.encrypted" | "reasoning.text"
	text?: string
	summary?: string
	data?: string // Encrypted reasoning data
	signature?: string | null
	id?: string | null // Unique identifier for the reasoning detail
	/**
	 * Format of the reasoning detail:
	 * - "unknown" - Format is not specified
	 * - "openai-responses-v1" - OpenAI responses format version 1
	 * - "anthropic-claude-v1" - Anthropic Claude format version 1 (default)
	 * - "google-gemini-v1" - Google Gemini format version 1
	 * - "xai-responses-v1" - xAI responses format version 1
	 */
	format?: string
	index?: number // Sequential index of the reasoning detail
}

/**
 * Consolidates reasoning_details by grouping by index and type.
 * - Filters out corrupted encrypted blocks (missing `data` field)
 * - For text blocks: concatenates text, keeps last signature/id/format
 * - For encrypted blocks: keeps only the last one per index
 *
 * @param reasoningDetails - Array of reasoning detail objects
 * @returns Consolidated array of reasoning details
 * @see https://github.com/cline/cline/issues/8214
 */
export function consolidateReasoningDetails(reasoningDetails: ReasoningDetail[]): ReasoningDetail[] {
	if (!reasoningDetails || reasoningDetails.length === 0) {
		return []
	}

	// Group by index
	const groupedByIndex = new Map<number, ReasoningDetail[]>()

	for (const detail of reasoningDetails) {
		// Drop corrupted encrypted reasoning blocks that would otherwise trigger:
		// "Invalid input: expected string, received undefined" for reasoning_details.*.data
		// See: https://github.com/cline/cline/issues/8214
		if (detail.type === "reasoning.encrypted" && !detail.data) {
			continue
		}

		const index = detail.index ?? 0
		if (!groupedByIndex.has(index)) {
			groupedByIndex.set(index, [])
		}
		groupedByIndex.get(index)!.push(detail)
	}

	// Consolidate each group
	const consolidated: ReasoningDetail[] = []

	for (const [index, details] of groupedByIndex.entries()) {
		// Concatenate all text parts
		let concatenatedText = ""
		let concatenatedSummary = ""
		let signature: string | undefined
		let id: string | undefined
		let format = "unknown"
		let type = "reasoning.text"

		for (const detail of details) {
			if (detail.text) {
				concatenatedText += detail.text
			}
			if (detail.summary) {
				concatenatedSummary += detail.summary
			}
			// Keep the signature from the last item that has one
			if (detail.signature) {
				signature = detail.signature
			}
			// Keep the id from the last item that has one
			if (detail.id) {
				id = detail.id
			}
			// Keep format and type from any item (they should all be the same)
			if (detail.format) {
				format = detail.format
			}
			if (detail.type) {
				type = detail.type
			}
		}

		// Create consolidated entry for text
		if (concatenatedText) {
			const consolidatedEntry: ReasoningDetail = {
				type: type,
				text: concatenatedText,
				signature: signature ?? undefined,
				id: id ?? undefined,
				format: format,
				index: index,
			}
			consolidated.push(consolidatedEntry)
		}

		// Create consolidated entry for summary (used by some providers)
		if (concatenatedSummary && !concatenatedText) {
			const consolidatedEntry: ReasoningDetail = {
				type: type,
				summary: concatenatedSummary,
				signature: signature ?? undefined,
				id: id ?? undefined,
				format: format,
				index: index,
			}
			consolidated.push(consolidatedEntry)
		}

		// For encrypted chunks (data), only keep the last one
		let lastDataEntry: ReasoningDetail | undefined
		for (const detail of details) {
			if (detail.data) {
				lastDataEntry = {
					type: detail.type,
					data: detail.data,
					signature: detail.signature ?? undefined,
					id: detail.id ?? undefined,
					format: detail.format,
					index: index,
				}
			}
		}
		if (lastDataEntry) {
			consolidated.push(lastDataEntry)
		}
	}

	return consolidated
}

/**
 * Sanitizes OpenAI messages for Gemini models by filtering reasoning_details
 * to only include entries that match the tool call IDs.
 *
 * Gemini models require thought signatures for tool calls. When switching providers
 * mid-conversation, historical tool calls may not include Gemini reasoning details,
 * which can poison the next request. This function:
 * 1. Filters reasoning_details to only include entries matching tool call IDs
 * 2. Drops tool_calls that lack any matching reasoning_details
 * 3. Removes corresponding tool result messages for dropped tool calls
 *
 * @param messages - Array of OpenAI chat completion messages
 * @param modelId - The model ID to check if sanitization is needed
 * @returns Sanitized array of messages (unchanged if not a Gemini model)
 * @see https://github.com/cline/cline/issues/8214
 */
export function sanitizeGeminiMessages(
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	modelId: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	// Only sanitize for Gemini models
	if (!modelId.includes("gemini")) {
		return messages
	}

	const droppedToolCallIds = new Set<string>()
	const sanitized: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const msg of messages) {
		if (msg.role === "assistant") {
			const anyMsg = msg as any
			const toolCalls = anyMsg.tool_calls as OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined
			const reasoningDetails = anyMsg.reasoning_details as ReasoningDetail[] | undefined

			if (Array.isArray(toolCalls) && toolCalls.length > 0) {
				const hasReasoningDetails = Array.isArray(reasoningDetails) && reasoningDetails.length > 0

				if (!hasReasoningDetails) {
					// No reasoning_details at all - drop all tool calls
					for (const tc of toolCalls) {
						if (tc?.id) {
							droppedToolCallIds.add(tc.id)
						}
					}
					// Keep any textual content, but drop the tool_calls themselves
					if (anyMsg.content) {
						sanitized.push({ role: "assistant", content: anyMsg.content } as any)
					}
					continue
				}

				// Filter reasoning_details to only include entries matching tool call IDs
				// This prevents mismatched reasoning details from poisoning the request
				const validToolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []
				const validReasoningDetails: ReasoningDetail[] = []

				for (const tc of toolCalls) {
					// Check if there's a reasoning_detail with matching id
					const matchingDetails = reasoningDetails.filter((d) => d.id === tc.id)

					if (matchingDetails.length > 0) {
						validToolCalls.push(tc)
						validReasoningDetails.push(...matchingDetails)
					} else {
						// No matching reasoning_detail - drop this tool call
						if (tc?.id) {
							droppedToolCallIds.add(tc.id)
						}
					}
				}

				// Also include reasoning_details that don't have an id (legacy format)
				const detailsWithoutId = reasoningDetails.filter((d) => !d.id)
				validReasoningDetails.push(...detailsWithoutId)

				// Build the sanitized message
				const sanitizedMsg: any = {
					role: "assistant",
					content: anyMsg.content ?? "",
				}

				if (validReasoningDetails.length > 0) {
					sanitizedMsg.reasoning_details = consolidateReasoningDetails(validReasoningDetails)
				}

				if (validToolCalls.length > 0) {
					sanitizedMsg.tool_calls = validToolCalls
				}

				sanitized.push(sanitizedMsg)
				continue
			}
		}

		if (msg.role === "tool") {
			const anyMsg = msg as any
			if (anyMsg.tool_call_id && droppedToolCallIds.has(anyMsg.tool_call_id)) {
				// Skip tool result for dropped tool call
				continue
			}
		}

		sanitized.push(msg)
	}

	return sanitized
}

/**
 * Options for converting Anthropic messages to OpenAI format.
 */
export interface ConvertToOpenAiMessagesOptions {
	/**
	 * Optional function to normalize tool call IDs for providers with strict ID requirements.
	 * When provided, this function will be applied to all tool_use IDs and tool_result tool_use_ids.
	 * This allows callers to declare provider-specific ID format requirements.
	 */
	normalizeToolCallId?: (id: string) => string
	/**
	 * If true, merge text content after tool_results into the last tool message
	 * instead of creating a separate user message. This is critical for providers
	 * with reasoning/thinking models (like DeepSeek-reasoner, GLM-4.7, etc.) where
	 * a user message after tool results causes the model to drop all previous
	 * reasoning_content. Default is false for backward compatibility.
	 */
	mergeToolResultText?: boolean
}

export function convertToOpenAiMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
	options?: ConvertToOpenAiMessagesOptions,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

	const mapReasoningDetails = (details: unknown): any[] | undefined => {
		if (!Array.isArray(details)) {
			return undefined
		}

		return details.map((detail: any) => {
			// Strip `id` from openai-responses-v1 blocks because OpenAI's Responses API
			// requires `store: true` to persist reasoning blocks. Since we manage
			// conversation state client-side, we don't use `store: true`, and sending
			// back the `id` field causes a 404 error.
			if (detail?.format === "openai-responses-v1" && detail?.id) {
				const { id, ...rest } = detail
				return rest
			}
			return detail
		})
	}

	// Use provided normalization function or identity function
	const normalizeId = options?.normalizeToolCallId ?? ((id: string) => id)

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			// Some upstream transforms (e.g. [`Task.buildCleanConversationHistory()`](src/core/task/Task.ts:4048))
			// will convert a single text block into a string for compactness.
			// If a message also contains reasoning_details (Gemini 3 / xAI / o-series, etc.),
			// we must preserve it here as well.
			const messageWithDetails = anthropicMessage as any
			const baseMessage: OpenAI.Chat.ChatCompletionMessageParam & { reasoning_details?: any[] } = {
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			}

			if (anthropicMessage.role === "assistant") {
				const mapped = mapReasoningDetails(messageWithDetails.reasoning_details)
				if (mapped) {
					;(baseMessage as any).reasoning_details = mapped
				}
			}

			openAiMessages.push(baseMessage)
		} else {
			// image_url.url is base64 encoded image data
			// ensure it contains the content-type of the image: data:image/png;base64,
			/*
        { role: "user", content: "" | { type: "text", text: string } | { type: "image_url", image_url: { url: string } } },
         // content required unless tool_calls is present
        { role: "assistant", content?: "" | null, tool_calls?: [{ id: "", function: { name: "", arguments: "" }, type: "function" }] },
        { role: "tool", tool_call_id: "", content: ""}
         */
			if (anthropicMessage.role === "user") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // user cannot send tool_use messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool result messages FIRST since they must follow the tool use messages
				let toolResultImages: Anthropic.Messages.ImageBlockParam[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the OpenAI SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										toolResultImages.push(part)
										return "(see following user message for image)"
									}
									return part.text
								})
								.join("\n") ?? ""
					}
					openAiMessages.push({
						role: "tool",
						tool_call_id: normalizeId(toolMessage.tool_use_id),
						// Use "(empty)" placeholder for empty content to satisfy providers like Gemini (via OpenRouter)
						content: content || "(empty)",
					})
				})

				// If tool results contain images, send as a separate user message
				// I ran into an issue where if I gave feedback for one of many tool uses, the request would fail.
				// "Messages following `tool_use` blocks must begin with a matching number of `tool_result` blocks."
				// Therefore we need to send these images after the tool result messages
				// NOTE: it's actually okay to have multiple user messages in a row, the model will treat them as a continuation of the same input (this way works better than combining them into one message, since the tool result specifically mentions (see following user message for image)
				// UPDATE v2.0: we don't use tools anymore, but if we did it's important to note that the openrouter prompt caching mechanism requires one user message at a time, so we would need to add these images to the user content array instead.
				// if (toolResultImages.length > 0) {
				// 	openAiMessages.push({
				// 		role: "user",
				// 		content: toolResultImages.map((part) => ({
				// 			type: "image_url",
				// 			image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
				// 		})),
				// 	})
				// }

				// Process non-tool messages
				// Filter out empty text blocks to prevent "must include at least one parts field" error
				// from Gemini (via OpenRouter). Images always have content (base64 data).
				const filteredNonToolMessages = nonToolMessages.filter(
					(part) => part.type === "image" || (part.type === "text" && part.text),
				)

				if (filteredNonToolMessages.length > 0) {
					// Check if we should merge text into the last tool message
					// This is critical for reasoning/thinking models where a user message
					// after tool results causes the model to drop all previous reasoning_content
					const hasOnlyTextContent = filteredNonToolMessages.every((part) => part.type === "text")
					const hasToolMessages = toolMessages.length > 0
					const shouldMergeIntoToolMessage =
						options?.mergeToolResultText && hasToolMessages && hasOnlyTextContent

					if (shouldMergeIntoToolMessage) {
						// Merge text content into the last tool message
						const lastToolMessage = openAiMessages[
							openAiMessages.length - 1
						] as OpenAI.Chat.ChatCompletionToolMessageParam
						if (lastToolMessage?.role === "tool") {
							const additionalText = filteredNonToolMessages
								.map((part) => (part as Anthropic.TextBlockParam).text)
								.join("\n")
							lastToolMessage.content = `${lastToolMessage.content}\n\n${additionalText}`
						}
					} else {
						// Standard behavior: add user message with text/image content
						openAiMessages.push({
							role: "user",
							content: filteredNonToolMessages.map((part) => {
								if (part.type === "image") {
									return {
										type: "image_url",

										image_url: {
											// kilocode_change begin support type==url
											url:
												part.source.type === "url"
													? part.source.url
													: `data:${part.source.media_type};base64,${part.source.data}`,
											// kilocode_change end
										},
									}
								}
								return { type: "text", text: part.text }
							}),
						})
					}
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // assistant cannot send tool_result messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages
				let content: string | undefined
				if (nonToolMessages.length > 0) {
					content = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								return "" // impossible as the assistant cannot send images
							}
							return part.text
						})
						.join("\n")
				}

				// Process tool use messages
				// Use type assertion to access extra_content which may be added for Gemini 3 support
				let tool_calls: (OpenAI.Chat.ChatCompletionMessageToolCall & {
					extra_content?: Record<string, unknown>
				})[] = toolMessages.map((toolMessage) => {
					const toolCall: OpenAI.Chat.ChatCompletionMessageToolCall & {
						extra_content?: Record<string, unknown>
					} = {
						id: normalizeId(toolMessage.id),
						type: "function",
						function: {
							name: toolMessage.name,
							// json string
							arguments: JSON.stringify(toolMessage.input),
						},
					}
					// Preserve extra_content for Gemini 3 thought_signature support
					const toolMessageWithExtra = toolMessage as any
					if (toolMessageWithExtra.extra_content) {
						toolCall.extra_content = toolMessageWithExtra.extra_content
					}
					return toolCall
				})

				// Check if the message has reasoning_details (used by Gemini 3, xAI, etc.)
				const messageWithDetails = anthropicMessage as any

				// Build message with reasoning_details BEFORE tool_calls to preserve
				// the order expected by providers like Roo. Property order matters
				// when sending messages back to some APIs.
				const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam & {
					reasoning_details?: any[]
				} = {
					role: "assistant",
					// Use empty string instead of undefined for providers like Gemini (via OpenRouter)
					// that require every message to have content in the "parts" field
					content: content ?? "",
				}

				// Pass through reasoning_details to preserve the original shape from the API.
				// The `id` field is stripped from openai-responses-v1 blocks (see mapReasoningDetails).
				const mapped = mapReasoningDetails(messageWithDetails.reasoning_details)
				if (mapped) {
					baseMessage.reasoning_details = mapped
				}

				// Add tool_calls after reasoning_details
				// Cannot be an empty array. API expects an array with minimum length 1, and will respond with an error if it's empty
				if (tool_calls.length > 0) {
					baseMessage.tool_calls = tool_calls
				}

				openAiMessages.push(baseMessage)
			}
		}
	}

	return openAiMessages
}
