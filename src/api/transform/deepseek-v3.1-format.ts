import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

type ContentPartText = OpenAI.Chat.ChatCompletionContentPartText
type ContentPartImage = OpenAI.Chat.ChatCompletionContentPartImage
type UserMessage = OpenAI.Chat.ChatCompletionUserMessageParam
type AssistantMessage = OpenAI.Chat.ChatCompletionAssistantMessageParam
type Message = OpenAI.Chat.ChatCompletionMessageParam
type AnthropicMessage = Anthropic.Messages.MessageParam

/**
 * Converts Anthropic messages to DeepSeek V3.1 format with proper chat template
 * that supports thinking mode. Based on the official DeepSeek V3.1 chat template.
 *
 * Chat template format:
 * - Non-thinking mode: <｜begin▁of▁sentence｜>{system}<｜User｜>{user}<｜Assistant｜></think>{response}<｜end▁of▁sentence｜>
 * - Thinking mode: <｜begin▁of▁sentence｜>{system}<｜User｜>{user}<｜Assistant｜><think>{reasoning}</think>{response}<｜end▁of▁sentence｜>
 *
 * @param systemPrompt The system prompt
 * @param messages Array of Anthropic messages
 * @param thinking Whether to enable thinking mode (default: true)
 * @returns Array of OpenAI messages formatted for DeepSeek V3.1
 */
export function convertToDeepSeekV31Format(
	systemPrompt: string,
	messages: AnthropicMessage[],
	thinking: boolean = true,
): Message[] {
	// Build the conversation manually using DeepSeek V3.1 chat template
	let conversation = ""
	let isFirstTurn = true

	// Add beginning of sentence token and system prompt
	if (systemPrompt.trim()) {
		conversation += `<｜begin▁of▁sentence｜>${systemPrompt}`
	} else {
		conversation += `<｜begin▁of▁sentence｜>`
	}

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]

		if (message.role === "user") {
			const userContent = extractTextContent(message.content)
			conversation += `<｜User｜>${userContent}`

			// Look ahead to see if there's an assistant response
			const nextMessage = messages[i + 1]
			if (nextMessage && nextMessage.role === "assistant") {
				// Assistant response follows, so start assistant turn
				if (thinking) {
					conversation += `<｜Assistant｜><think>`
				} else {
					conversation += `<｜Assistant｜></think>`
				}
			}
		} else if (message.role === "assistant") {
			const assistantContent = extractTextContent(message.content)

			// Handle thinking mode formatting
			if (thinking) {
				// If content contains <think>...</think>, extract it
				const thinkMatch = assistantContent.match(/<think>(.*?)<\/think>(.*)/s)
				if (thinkMatch) {
					conversation += thinkMatch[1] + "</think>" + thinkMatch[2]
				} else {
					// No explicit thinking tags, treat as non-thinking response
					conversation += "</think>" + assistantContent
				}
			} else {
				// Non-thinking mode, remove any thinking tags and add the response
				const cleanContent = assistantContent.replace(/<think>.*?<\/think>/gs, "").trim()
				conversation += cleanContent
			}

			// End the turn
			conversation += `<｜end▁of▁sentence｜>`
		}
	}

	// Add generation prompt for the final assistant turn if needed
	const lastMessage = messages[messages.length - 1]
	if (lastMessage && lastMessage.role === "user") {
		if (thinking) {
			conversation += `<｜Assistant｜><think>`
		} else {
			conversation += `<｜Assistant｜></think>`
		}
	}

	// Return as a single user message containing the entire formatted conversation
	// This follows the pattern where the entire conversation is sent as a single prompt
	return [
		{
			role: "user",
			content: conversation,
		},
	]
}

/**
 * Extract text content from Anthropic message content
 */
function extractTextContent(content: string | Anthropic.Messages.ContentBlock[]): string {
	if (typeof content === "string") {
		return content
	}

	if (Array.isArray(content)) {
		return content
			.filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("\n")
	}

	return ""
}

/**
 * Alternative implementation that preserves OpenAI message structure
 * while applying DeepSeek V3.1 formatting to the content
 */
export function convertToDeepSeekV31Messages(
	systemPrompt: string,
	messages: AnthropicMessage[],
	thinking: boolean = true,
): Message[] {
	const result: Message[] = []

	// Add system message with special formatting
	if (systemPrompt.trim()) {
		result.push({
			role: "system",
			content: systemPrompt,
		})
	}

	// Process each message with DeepSeek V3.1 specific formatting
	for (const message of messages) {
		if (message.role === "user") {
			const userContent = extractTextContent(message.content)
			result.push({
				role: "user",
				content: userContent,
			})
		} else if (message.role === "assistant") {
			const assistantContent = extractTextContent(message.content)

			// Apply thinking mode formatting to assistant messages
			let formattedContent = assistantContent
			if (thinking) {
				// Ensure proper thinking tags if not already present
				if (!formattedContent.includes("<think>") && !formattedContent.includes("</think>")) {
					// Add thinking wrapper for better reasoning
					formattedContent = `<think>\nLet me think about this...\n</think>\n${formattedContent}`
				}
			} else {
				// Remove thinking tags for non-thinking mode
				formattedContent = formattedContent.replace(/<think>.*?<\/think>/gs, "").trim()
			}

			result.push({
				role: "assistant",
				content: formattedContent,
			})
		}
	}

	return result
}
