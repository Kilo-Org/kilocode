import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

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
						content: content,
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
				if (nonToolMessages.length > 0) {
					// Check if we should merge text into the last tool message
					// This is critical for reasoning/thinking models where a user message
					// after tool results causes the model to drop all previous reasoning_content
					const hasOnlyTextContent = nonToolMessages.every((part) => part.type === "text")
					const hasToolMessages = toolMessages.length > 0
					const shouldMergeIntoToolMessage =
						options?.mergeToolResultText && hasToolMessages && hasOnlyTextContent

					if (shouldMergeIntoToolMessage) {
						// Merge text content into the last tool message
						const lastToolMessage = openAiMessages[
							openAiMessages.length - 1
						] as OpenAI.Chat.ChatCompletionToolMessageParam
						if (lastToolMessage?.role === "tool") {
							const additionalText = nonToolMessages
								.map((part) => (part as Anthropic.TextBlockParam).text)
								.join("\n")
							lastToolMessage.content = `${lastToolMessage.content}\n\n${additionalText}`
						}
					} else {
						// Standard behavior: add user message with text/image content
						openAiMessages.push({
							role: "user",
							content: nonToolMessages.map((part) => {
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
					nonToolMessages: (
						| Anthropic.TextBlockParam
						| Anthropic.ImageBlockParam
						| Anthropic.ThinkingBlockParam
						| any
					)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} else if (part.type === "thinking" || (part as any).type === "reasoning") {
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
							} else if (part.type === "thinking") {
								return "<think>" + part.thinking + "</think>"
							} else if (part.type === "reasoning") {
								// kilocode_change - support custom "reasoning" type used by some providers
								return "<think>" + (part.text || part.thinking || "") + "</think>"
							}
							return part.text
						})
						.join("\n")
				}

				// Process tool use messages
				let tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => ({
					id: normalizeId(toolMessage.id),
					type: "function",
					function: {
						name: toolMessage.name,
						// json string
						arguments: JSON.stringify(toolMessage.input),
					},
				}))

				// Check if the message has reasoning_details (used by Gemini 3, xAI, etc.)
				const messageWithDetails = anthropicMessage as any

				// Build message with reasoning_details BEFORE tool_calls to preserve
				// the order expected by providers like Roo. Property order matters
				// when sending messages back to some APIs.
				const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam & {
					reasoning_details?: any[]
				} = {
					role: "assistant",
					content,
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
