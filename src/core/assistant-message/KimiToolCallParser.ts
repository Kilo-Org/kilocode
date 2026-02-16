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
 * This parser handles streaming by accumulating text across chunks and detecting
 * complete tool call sections when <|tool_calls_section_end|> is received.
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

// Internal state for the parser
let toolCallCounter = 0
let accumulator = ""

const SECTION_BEGIN = "<|tool_calls_section_begin|>"
const SECTION_END = "<|tool_calls_section_end|>"

/**
 * Clean tool call markers from text
 */
function cleanText(text: string): string {
	return text
		.replace(/<\|tool_calls_section_begin\|>/g, "")
		.replace(/<\|tool_calls_section_end\|>/g, "")
		.replace(/<\|tool_call_begin\|>/g, "")
		.replace(/<\|tool_call_argument_begin\|>/g, "")
		.replace(/<\|tool_call_argument_end\|>/g, "")
		.replace(/<\|tool_call_end\|>/g, "")
		.trim()
}

/**
 * Stateful parser for Kimi-style tool calls that handles streaming fragmentation.
 * Accumulates reasoning text across chunks and detects complete tool call sections.
 */
export class KimiToolCallParser {
	/**
	 * Process a chunk of reasoning text and check for complete tool call sections.
	 * Returns extracted tool calls if a complete section is found, otherwise empty array.
	 * The cleaned text (with tool call markers removed) is returned separately.
	 */
	public static processChunk(text: string): { cleanedText: string; toolCalls: ToolCallData[] } {
		// Accumulate the text
		accumulator += text

		const toolCalls: ToolCallData[] = []
		let cleanedText = ""
		let lastSectionEndPos = 0

		// Loop to find ALL complete tool call sections in the accumulator
		while (true) {
			const sectionStartIndex = accumulator.indexOf(SECTION_BEGIN, lastSectionEndPos)
			const sectionEndIndex = accumulator.indexOf(SECTION_END, sectionStartIndex + SECTION_BEGIN.length)

			if (sectionStartIndex !== -1 && sectionEndIndex !== -1 && sectionEndIndex > sectionStartIndex) {
				// Extract this complete section
				const sectionEnd = sectionEndIndex + SECTION_END.length
				const fullSection = accumulator.substring(sectionStartIndex, sectionEnd)

				// Parse tool calls from this section
				const result = parseKimiToolCallsInternal(fullSection)
				toolCalls.push(...result.toolCalls)

				lastSectionEndPos = sectionEnd
			} else {
				// No more complete sections
				break
			}
		}

		// Check if there's an incomplete section (have begin but no end)
		const currentStartIndex = accumulator.indexOf(SECTION_BEGIN, lastSectionEndPos)

		if (currentStartIndex !== -1) {
			// There's an incomplete section - return text before it
			cleanedText = cleanText(accumulator.substring(lastSectionEndPos, currentStartIndex))
		} else {
			// No incomplete section - return remaining text after last complete section
			cleanedText = cleanText(accumulator.substring(lastSectionEndPos))
		}

		return { cleanedText, toolCalls }
	}

	/**
	 * Check if accumulated text contains start of a tool call section
	 */
	public static hasPartialToolCalls(): boolean {
		return accumulator.includes(SECTION_BEGIN)
	}

	/**
	 * Check if we have a complete tool call section
	 */
	public static hasCompleteToolCalls(): boolean {
		const sectionStartIndex = accumulator.indexOf(SECTION_BEGIN)
		const sectionEndIndex = accumulator.indexOf(SECTION_END)
		return sectionStartIndex !== -1 && sectionEndIndex !== -1 && sectionEndIndex > sectionStartIndex
	}

	/**
	 * Reset the parser state (useful for testing or between messages)
	 */
	public static reset(): void {
		accumulator = ""
	}

	/**
	 * Set the tool call counter (useful for testing to get deterministic IDs)
	 */
	public static setCounter(value: number): void {
		toolCallCounter = value
	}

	/**
	 * Get current accumulator content (useful for debugging)
	 */
	public static getAccumulator(): string {
		return accumulator
	}
}

/**
 * Internal function to parse Kimi-style tool calls from text.
 * Returns an object with:
 * - cleanedText: the text with tool call markers removed
 * - toolCalls: array of extracted tool calls
 */
function parseKimiToolCallsInternal(text: string): { cleanedText: string; toolCalls: ToolCallData[] } {
	const toolCalls: ToolCallData[] = []

	// Pattern to match the full tool call block
	// <|tool_calls_section_begin|> ... <|tool_call_begin|> tool_name <|tool_call_argument_begin|> args <|tool_call_end|> ... <|tool_calls_section_end|>
	const toolCallBlockRegex = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g

	// Pattern to match individual tool calls within the block
	const toolCallRegex =
		/<\|tool_call_begin\|>\s*(.+?)\s*<\|tool_call_argument_begin\|>\s*(\{[\s\S]*?\})\s*<\|tool_call_end\|>/g

	// Find all tool call sections and extract them
	const sections: string[] = []
	let match
	while ((match = toolCallBlockRegex.exec(text)) !== null) {
		sections.push(match[1])
	}

	// Extract individual tool calls from each section
	for (const section of sections) {
		while ((match = toolCallRegex.exec(section)) !== null) {
			const fullName = match[1].trim()
			const args = match[2]

			// Generate a unique ID for the tool call using counter only (deterministic)
			const id = `kimicall_${++toolCallCounter}`

			toolCalls.push({
				id,
				name: fullName,
				arguments: args,
			})
		}
	}

	// Remove all tool call sections from the text
	const cleanedText = text.replace(toolCallBlockRegex, "")

	// Clean up any remaining orphaned markers
	const finalCleanedText = cleanText(cleanedText)

	return { cleanedText: finalCleanedText, toolCalls }
}

/**
 * Parse Kimi-style tool calls from thinking/reasoning text.
 * Returns an object with:
 * - cleanedText: the thinking text with tool call markers removed
 * - toolCalls: array of extracted tool calls
 */
export function parseKimiToolCalls(text: string): { cleanedText: string; toolCalls: ToolCallData[] } {
	return parseKimiToolCallsInternal(text)
}

/**
 * Check if text contains Kimi-style tool call markers (for detection)
 * Note: This is a simple check for the section begin marker
 */
export function hasKimiToolCalls(text: string): boolean {
	return text.includes("<|tool_calls_section_begin|>")
}

/**
 * Convert extracted Kimi tool calls to API stream chunks
 */
export function kimiToolCallsToStreamChunks(toolCalls: ToolCallData[]): ApiStreamChunk[] {
	const chunks: ApiStreamChunk[] = []

	for (const toolCall of toolCalls) {
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

/**
 * @deprecated Use kimiToolCallsToStreamChunks instead
 */
export const kimToolCallsToStreamChunks = kimiToolCallsToStreamChunks
