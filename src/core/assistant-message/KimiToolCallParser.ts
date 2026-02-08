/**
 * Parser for Kimi-style tool calls that are embedded in thinking/reasoning text.
 * Kimi K2.5 and similar models produce tool calls with special markers:
 * - <|tool_calls_section_begin|>
 * - <|tool_call_begin|>
 * - <|tool_call_argument_begin|>
 * - <|tool_call_argument_end|>
 * - <|tool_call_end|>
 * - <|tool_calls_section_end|>
 *
 * Example format:
 * <|tool_calls_section_begin|> <|tool_call_begin|> functions.edit:31 <|tool_call_argument_begin|> {"filePath": "..."
 */

import type { ApiStreamChunk } from "../../api/transform/stream"

interface ToolCallData {
	id: string
	name: string
	arguments: string
}

/**
 * Parse Kimi-style tool calls from thinking/reasoning text.
 * Returns an object with:
 * - cleanedText: the thinking text with tool call markers removed
 * - toolCalls: array of extracted tool calls
 */
export function parseKimiToolCalls(text: string): { cleanedText: string; toolCalls: ToolCallData[] } {
	const toolCalls: ToolCallData[] = []
	let cleanedText = text

	// Pattern to match the full tool call block
	// <|tool_calls_section_begin|> ... <|tool_call_begin|> tool_name <|tool_call_argument_begin|> args <|tool_call_end|> ... <|tool_calls_section_end|>
	const toolCallBlockRegex = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g

	// Pattern to match individual tool calls within the block
	// <|tool_call_begin|> function.name <|tool_call_argument_begin|> {args} <|tool_call_end|>
	const toolCallRegex =
		/<\|tool_call_begin\|>\s*(.+?)\s*<\|tool_call_argument_begin\|>\s*(\{[\s\S]*?\})\s*<\|tool_call_end\|>/g

	// Find all tool call sections and extract them
	const sections: string[] = []
	let match
	while ((match = toolCallBlockRegex.exec(text)) !== null) {
		sections.push(match[1])
	}

	// Extract individual tool calls from each section
	let toolCallCounter = 0
	for (const section of sections) {
		while ((match = toolCallRegex.exec(section)) !== null) {
			const fullName = match[1].trim()
			const args = match[2]

			// Generate a unique ID for the tool call
			const id = `kimicall_${++toolCallCounter}_${Date.now()}`

			toolCalls.push({
				id,
				name: fullName,
				arguments: args,
			})
		}
	}

	// Remove all tool call sections from the text
	cleanedText = text.replace(toolCallBlockRegex, "")

	// Clean up any remaining orphaned markers
	cleanedText = cleanedText
		.replace(/<\|tool_call_begin\|>/g, "")
		.replace(/<\|tool_call_argument_begin\|>/g, "")
		.replace(/<\|tool_call_argument_end\|>/g, "")
		.replace(/<\|tool_call_end\|>/g, "")
		.trim()

	return { cleanedText, toolCalls }
}

/**
 * Check if text contains Kimi-style tool call markers
 */
export function hasKimiToolCalls(text: string): boolean {
	return (
		text.includes("<|tool_calls_section_begin|>") &&
		text.includes("<|tool_call_begin|>") &&
		text.includes("<|tool_call_argument_begin|>")
	)
}

/**
 * Convert extracted Kimi tool calls to API stream chunks
 */
export function kimToolCallsToStreamChunks(toolCalls: ToolCallData[]): ApiStreamChunk[] {
	const chunks: ApiStreamChunk[] = []

	for (const toolCall of toolCalls) {
		// Split the function name (e.g., "functions.edit" -> name: "functions.edit")
		// But NativeToolCallParser expects just the tool name
		const name = toolCall.name

		// Generate an index for the tool call
		const index = chunks.length

		chunks.push({
			type: "tool_call_partial",
			index,
			id: toolCall.id,
			name,
			arguments: toolCall.arguments,
		})
	}

	return chunks
}
