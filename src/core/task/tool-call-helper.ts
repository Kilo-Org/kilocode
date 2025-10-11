/**
 * @fileoverview
 * This file contains the implementation of a streaming JSON to XML converter
 * for handling tool calls from AI models. It uses a state machine and stacks
 * to process incoming JSON chunks incrementally and generate corresponding XML representations.
 */

import Anthropic from "@anthropic-ai/sdk"
import { ToolCallProviderType } from "../../shared/tools"
import { getToolRegistry } from "../prompts/tools/schemas/tool-registry"
import { type ToolName } from "@roo-code/types"

/**
 * Defines the possible states of the JSON parser.
 */
enum ParserState {
	EXPECT_ROOT, // Expecting root object or array
	EXPECT_VALUE,
	EXPECT_KEY,
	EXPECT_COLON,
	EXPECT_COMMA_OR_CLOSING,
}

export interface ToolCallParam {
	providerType: ToolCallProviderType
	toolName: string
	toolUserId: string
	chunkContent: string
	anthropicContent?: Anthropic.ToolUseBlockParam
	originContent: any[]
}

/**
 * Represents the processing state for a single tool call.
 * It tracks the parsing progress, state, and structural information.
 */
class ToolCallProcessingState {
	functionNameOutputted = false
	functionClosed = false

	// The full arguments string accumulated so far.
	arguments = ""
	// The index of the next character to process in the arguments string.
	cursor = 0

	// The current state of the parser FSM (Finite State Machine).
	parserState = ParserState.EXPECT_ROOT

	// Flags for handling string parsing.
	inString = false
	isEscaped = false
	isStreamingStringValue = false

	// Stack to keep track of JSON objects ({) and arrays ([).
	bracketStack: ("{" | "[")[] = []
	// Stack to keep track of XML tags for generating closing tags correctly.
	xmlTagStack: string[] = []
	// Buffer for the current string literal (key or value) being parsed.
	currentString = ""
	// Buffer for accumulating primitive values across chunks
	primitiveBuffer = ""
	// Flag to track if we're at the start of an array to prevent duplicate tags.
	justOpenedArray = false
}

/**
 * A streaming processor that converts tool call JSON chunks into XML format in real-time.
 */
export class StreamingToolCallProcessor {
	private accumulatedToolCalls: any[] = []
	private processingStates: Map<number, ToolCallProcessingState> = new Map()

	/**
	 * Processes a new chunk of tool call data and returns the resulting XML segment.
	 * @param chunk - The tool call chunk, typically from a streaming API.
	 * @returns A string containing the newly generated XML.
	 */
	public processChunk(chunk: any, providerType: ToolCallProviderType = "openai"): string {
		switch (providerType) {
			case "openai":
				return this.processChunkOpenAIFormat(chunk).chunkContent
			default:
				throw new Error(`Unsupported provider type: ${providerType}`)
		}
	}

	/**
	 * Processes a new chunk of tool call data and returns the resulting XML segment.
	 * @param chunk - The tool call chunk, typically from a streaming API.
	 * @returns A string containing the newly generated XML.
	 */
	public processChunkTool(chunk: any, providerType: ToolCallProviderType = "openai"): ToolCallParam {
		switch (providerType) {
			case "openai":
				return this.processChunkOpenAIFormat(chunk)
			default:
				throw new Error(`Unsupported provider type: ${providerType}`)
		}
	}

	/**
	 * Processes a new chunk of tool call data for the OpenAI provider.
	 * @param chunk - The tool call chunk to process.
	 * @returns A string containing the resulting XML segment.
	 */
	private processChunkOpenAIFormat(chunk: any): ToolCallParam {
		let xmlOutput = ""
		let index = 0
		// Check if the tool name is valid using the tool registry
		const toolRegistry = getToolRegistry()
		for (const delta of chunk) {
			index = delta.index || 0

			// Initialize state for a new tool call.
			if (!this.accumulatedToolCalls[index]) {
				this.accumulatedToolCalls[index] = {
					id: delta.id || "",
					type: "function",
					function: { name: "", arguments: "" },
				}
				this.processingStates.set(index, new ToolCallProcessingState())
			}

			const toolCall = this.accumulatedToolCalls[index]
			const state = this.processingStates.get(index)!

			// Accumulate function name and arguments.
			if (delta.function?.name) {
				toolCall.function.name += delta.function.name
			}
			if (delta.function?.arguments) {
				toolCall.function.arguments += delta.function.arguments
			}

			const isValidToolName =
				toolCall.function.name && toolRegistry.isToolSupported(toolCall.function.name as ToolName)

			// Output the opening function tag once the name is known and valid.
			if (isValidToolName && !state.functionNameOutputted) {
				xmlOutput += `<${toolCall.function.name}>`
				state.functionNameOutputted = true
				// When we first output the function name, also process any accumulated arguments
				if (toolCall.function.arguments.length > 0) {
					state.arguments = toolCall.function.arguments
					xmlOutput += this.processArguments(state, toolCall.function.name)
				}
			} else if (state.functionNameOutputted && toolCall.function.arguments.length > state.arguments.length) {
				// Process new arguments chunk only if we already have a valid function name
				state.arguments = toolCall.function.arguments
				xmlOutput += this.processArguments(state, toolCall.function.name)
			}

			// Check if the JSON is complete and close the function tag.
			if (isValidToolName && !state.functionClosed && state.bracketStack.length === 0 && state.cursor > 0) {
				// A simple check to see if we've reached a terminal state.
				// A more robust check might be necessary for edge cases.
				const remaining = state.arguments.substring(state.cursor).trim()
				if (remaining === "") {
					xmlOutput += `</${toolCall.function.name}>\n\n`
					state.functionClosed = true
				}
			}
		}
		// the index of GPT-5 tool_call not start by 0
		const toolCall = this.accumulatedToolCalls[index]
		const toolName = toolCall?.function?.name as ToolName
		const isValidToolName = toolName && toolRegistry.isToolSupported(toolName)

		const result: ToolCallParam = {
			providerType: "openai",
			toolName: isValidToolName ? toolName : "",
			toolUserId: toolCall?.id || undefined,
			chunkContent: xmlOutput,
			originContent: this.accumulatedToolCalls,
		}

		// Provide a temporary anthropicContent (input) during streaming before final closure
		const currentState = this.processingStates.get(index)
		if (currentState && !currentState.functionClosed && isValidToolName) {
			const tmpInput = this.tryBuildTemporaryJson(currentState, toolCall.function.arguments)
			if (tmpInput != null) {
				result.anthropicContent = {
					id: result.toolUserId,
					name: result.toolName,
					input: tmpInput,
					type: "tool_use",
				}
			}
		}

		if (this.processingStates.get(index)?.functionClosed && isValidToolName) {
			let input
			try {
				input = JSON.parse(toolCall.function.arguments)
			} catch (e) {
				input = ""
			}
			result.anthropicContent = {
				id: result.toolUserId,
				name: result.toolName,
				input: input,
				type: "tool_use",
			}
		}
		return result
	}

	/**
	 * Finalizes the XML output, closing any remaining open tags.
	 * @returns a string with the closing XML tags.
	 */
	public finalize(): string {
		let finalXml = ""
		const toolRegistry = getToolRegistry()

		for (let i = 0; i < this.accumulatedToolCalls.length; i++) {
			const state = this.processingStates.get(i)
			const toolCall = this.accumulatedToolCalls[i]

			if (!state || !toolCall || state.functionClosed) {
				continue
			}

			// Check if the tool name is valid
			const isValidToolName =
				toolCall.function.name && toolRegistry.isToolSupported(toolCall.function.name as ToolName)

			if (!isValidToolName) {
				continue
			}

			// Process any remaining buffered arguments
			if (toolCall.function.arguments.length > state.arguments.length) {
				state.arguments = toolCall.function.arguments
				finalXml += this.processArguments(state, toolCall.function.name)
			}

			// Close remaining tags from the stack in reverse order.
			while (state.xmlTagStack.length > 0) {
				const tag = state.xmlTagStack.pop()!
				const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
				finalXml += `${this.getIndent(xmlLevel)}${this.onCloseTag(tag, toolCall.function.name)}`
			}

			if (state.functionNameOutputted) {
				finalXml += `</${toolCall.function.name}>\n`
			}
		}
		return finalXml
	}

	/**
	 * Resets the processor to its initial state for a new sequence of tool calls.
	 */
	public reset(): void {
		this.accumulatedToolCalls = []
		this.processingStates.clear()
	}

	/**
	 * Generates indentation for pretty-printing the XML output.
	 * @param level - The desired indentation level.
	 * @returns A string of tabs.
	 */
	private getIndent(level: number): string {
		if (level >= 0) {
			return "\t".repeat(level)
		}
		return ""
	}

	/**
	 * The core state machine for parsing JSON arguments and generating XML.
	 * @param state - The current processing state for a tool call.
	 * @param toolName - The name of the current tool being processed.
	 * @returns The generated XML string for the processed chunk.
	 */
	private processArguments(state: ToolCallProcessingState, toolName: string): string {
		let xml = ""
		const args = state.arguments

		while (state.cursor < args.length) {
			const char = args[state.cursor]

			if (state.inString) {
				if (state.isStreamingStringValue) {
					// --- Streaming Logic for String Values (character by character) ---
					if (char === "\\") {
						// Handle escape sequence.
						const escapeSequence = this.getFullEscapeSequence(args, state.cursor)
						if (escapeSequence) {
							try {
								// Use JSON.parse on the smallest possible valid JSON string
								// to robustly unescape the sequence.
								xml += JSON.parse('"' + escapeSequence + '"')
							} catch (e) {
								// Fallback for incomplete escape sequences at the end of a chunk.
								xml += escapeSequence
							}
							state.cursor += escapeSequence.length
						} else {
							// Incomplete escape sequence (e.g., `\` at the end of a chunk).
							// Stop processing this chunk and wait for the next one.
							return xml
						}
					} else if (char === '"') {
						// End of string value.
						state.inString = false
						state.isStreamingStringValue = false
						const parent = state.bracketStack[state.bracketStack.length - 1]
						if (parent === "{") {
							const tag = state.xmlTagStack.pop()!
							if (tag) {
								xml += `${this.onCloseTag(tag, toolName)}`
							}
						} else if (parent === "[") {
							// For array elements, close the current tag and prepare for next element
							const arrayElementTag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (arrayElementTag) {
								xml += `${this.onCloseTag(arrayElementTag, toolName)}`
							}
						}
						state.parserState = ParserState.EXPECT_COMMA_OR_CLOSING
						state.cursor++ // Consume the quote
					} else {
						// Regular character in a string, output directly.
						xml += char
						state.cursor++
					}
				} else {
					// --- Buffering Logic for String Keys ---
					if (char === "\\" && !state.isEscaped) {
						state.currentString += "\\"
						state.isEscaped = true
					} else if (char === '"' && !state.isEscaped) {
						state.inString = false
						let finalString
						try {
							finalString = JSON.parse('"' + state.currentString + '"')
						} catch (e) {
							finalString = state.currentString
						}

						// This must be a key, because values are streamed.
						state.xmlTagStack.push(finalString)
						// Don't output the opening tag yet - wait to see if this is an array
						state.parserState = ParserState.EXPECT_COLON
						state.currentString = ""
					} else {
						state.currentString += char
						state.isEscaped = false
					}
					state.cursor++
				}
				continue
			}

			if (/\s/.test(char)) {
				state.cursor++
				continue
			}

			// Handle primitives - accumulate characters until we hit a delimiter
			if (state.parserState === ParserState.EXPECT_VALUE) {
				// Check if this character could be part of a primitive value
				if (
					(char >= "0" && char <= "9") ||
					char === "-" ||
					char === "." ||
					(char >= "a" && char <= "z") ||
					(char >= "A" && char <= "Z")
				) {
					// Accumulate the character
					state.primitiveBuffer += char
					state.cursor++
					continue
				} else if (state.primitiveBuffer.length > 0) {
					// We've hit a delimiter, check if we have a complete primitive
					const value = state.primitiveBuffer.trim()
					if (value === "true" || value === "false" || value === "null" || /^-?\d+(\.\d+)?$/.test(value)) {
						// We have a valid primitive
						const parent = state.bracketStack[state.bracketStack.length - 1]
						if (parent === "[") {
							// For array elements
							const arrayElementTag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (arrayElementTag) {
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onOpenTag(arrayElementTag, toolName)}${value}${this.onCloseTag(arrayElementTag, toolName)}`
							}
						} else {
							// For object properties
							const tag = state.xmlTagStack.pop()!
							if (tag) {
								xml += `${value}${this.onCloseTag(tag, toolName)}`
							}
						}
						state.parserState = ParserState.EXPECT_COMMA_OR_CLOSING
						state.primitiveBuffer = ""
						// Don't increment cursor - let the delimiter be processed in the switch
						continue
					} else {
						// Invalid primitive, reset buffer and continue
						state.primitiveBuffer = ""
					}
				}
			}

			switch (char) {
				case "{":
					if (
						state.parserState === ParserState.EXPECT_VALUE ||
						state.parserState === ParserState.EXPECT_ROOT
					) {
						const parent = state.bracketStack[state.bracketStack.length - 1]
						if (parent === "[") {
							// For an object inside an array, we need to add the repeating tag.
							const arrayElementTag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (arrayElementTag) {
								// Array elements should be at the same level as their array key
								// XML level = containing object level
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onOpenTag(arrayElementTag, toolName)}`
							}
						}
						state.bracketStack.push("{")
						state.parserState = ParserState.EXPECT_KEY
						xml += "\n"
						// Any value inside an array consumes the "justOpenedArray" state.
						state.justOpenedArray = false
					}
					break
				case "}":
					if (
						state.parserState === ParserState.EXPECT_KEY ||
						state.parserState === ParserState.EXPECT_COMMA_OR_CLOSING
					) {
						const parentBeforePop = state.bracketStack[state.bracketStack.length - 1]
						state.bracketStack.pop() // Pop '{'
						const parentAfterPop = state.bracketStack[state.bracketStack.length - 1]

						if (parentBeforePop === "{" && parentAfterPop === "[") {
							// Closing an object that is inside an array.
							const arrayElementTag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (arrayElementTag) {
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onCloseTag(arrayElementTag, toolName)}`
							}
							// Don't pop from xmlTagStack - we need to reuse the array element tag
						} else {
							// Normal object closure.
							const tag = state.xmlTagStack.pop()!
							if (tag) {
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onCloseTag(tag, toolName)}`
							}
						}
						state.parserState = ParserState.EXPECT_COMMA_OR_CLOSING
					}
					break
				case "[":
					if (
						state.parserState === ParserState.EXPECT_VALUE ||
						state.parserState === ParserState.EXPECT_ROOT
					) {
						state.bracketStack.push("[")
						state.parserState = ParserState.EXPECT_VALUE // An array contains values
						state.justOpenedArray = true
						// Don't add anything to xmlTagStack here - wait for the actual array elements
					}
					break
				case "]":
					if (
						state.parserState === ParserState.EXPECT_VALUE || // handles empty array e.g. []
						state.parserState === ParserState.EXPECT_COMMA_OR_CLOSING
					) {
						// If this is an empty array (we just opened it and immediately closing), output empty tag pair
						if (
							state.parserState === ParserState.EXPECT_VALUE &&
							state.justOpenedArray &&
							state.xmlTagStack.length > 0
						) {
							const tag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (tag) {
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onOpenTag(tag, toolName)}${this.onCloseTag(tag, toolName)}`
							}
						}

						state.bracketStack.pop() // Pop '['
						// For arrays, we keep the tag on the stack for reuse, but only pop it when we close the array
						if (state.xmlTagStack.length > 0) {
							state.xmlTagStack.pop() // Pop the array's tag name, its job is done.
						}
						state.parserState = ParserState.EXPECT_COMMA_OR_CLOSING
						state.justOpenedArray = false
					}
					break
				case '"':
					if (state.parserState === ParserState.EXPECT_VALUE) {
						// We've encountered the start of a string that is a JSON value.
						state.isStreamingStringValue = true
						state.inString = true
						// If we're in an array, we need to open a tag for this array element
						const parent = state.bracketStack[state.bracketStack.length - 1]
						if (parent === "[") {
							const arrayElementTag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (arrayElementTag) {
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onOpenTag(arrayElementTag, toolName)}`
							}
						}
					} else if (state.parserState === ParserState.EXPECT_KEY) {
						// This is the start of a string that is a JSON key.
						state.isStreamingStringValue = false
						state.inString = true
					}
					break
				case ":":
					if (state.parserState === ParserState.EXPECT_COLON) {
						// Look ahead to see if this is an array or a regular value
						let nextNonWhitespace = ""
						for (let i = state.cursor + 1; i < args.length; i++) {
							if (!/\s/.test(args[i])) {
								nextNonWhitespace = args[i]
								break
							}
						}

						// If the next non-whitespace character is not '[', output the opening tag now
						if (nextNonWhitespace !== "[") {
							const tag = state.xmlTagStack[state.xmlTagStack.length - 1]
							if (tag) {
								// For regular object properties, calculate XML indentation level
								// XML level = JSON object nesting - 1 (since root tool object doesn't count)
								const xmlLevel = Math.max(0, state.bracketStack.filter((b) => b === "{").length - 1)
								xml += `${this.getIndent(xmlLevel)}${this.onOpenTag(tag, toolName)}`
							}
						}

						state.parserState = ParserState.EXPECT_VALUE
					}
					break
				case ",":
					if (state.parserState === ParserState.EXPECT_COMMA_OR_CLOSING) {
						const parent = state.bracketStack[state.bracketStack.length - 1]
						state.parserState = parent === "{" ? ParserState.EXPECT_KEY : ParserState.EXPECT_VALUE
					}
					break
			}
			state.cursor++
		}
		return xml
	}

	/**
	 * Extracts a complete JSON escape sequence from a string, starting at a given position.
	 * @param str - The string containing the escape sequence.
	 * @param pos - The starting position of the backslash.
	 * @returns The full escape sequence (e.g., "\\n", "\\uABCD") or null if incomplete.
	 */
	private getFullEscapeSequence(str: string, pos: number): string | null {
		if (pos < 0 || str[pos] !== "\\") {
			return null
		}
		// If the backslash is the last character, we need more data.
		if (pos + 1 >= str.length) {
			return null
		}
		const nextChar = str[pos + 1]
		if (nextChar === "u") {
			// A unicode escape sequence requires 4 hex digits.
			if (pos + 5 >= str.length) {
				return null // Incomplete unicode sequence.
			}
			const hex = str.substring(pos + 2, pos + 6)
			// Basic validation for hex characters.
			if (/^[0-9a-fA-F]{4}$/.test(hex)) {
				return "\\u" + hex
			}
			return null
		}
		// For simple escapes like \n, \", \\, etc.
		return str.substring(pos, pos + 2)
	}

	/**
	 * Attempts to construct a temporarily valid JSON string from the current streaming buffer and parser state,
	 * allowing JSON.parse to succeed and provide a usable anthropicContent.input during partial tool call streaming.
	 * This function does NOT mutate the original parser state; it operates only on copies.
	 *
	 * Implementation details:
	 * - If currently parsing a string, closes the string with a quote and removes incomplete escape/unicode sequences.
	 * - If a primitive value (true/false/null/number) is incomplete, auto-completes it to a valid JSON token.
	 * - Closes all unclosed object/array brackets, inserting "null" where a value is expected.
	 * - Removes trailing commas before closing brackets to avoid JSON syntax errors.
	 * - On initial parse failure, tries to append "null" or repeatedly trim trailing commas and retries parsing.
	 * - Only used for constructing intermediate JSON during streaming; final result should use fully parsed content.
	 */
	private tryBuildTemporaryJson(state: ToolCallProcessingState, rawArgs: string): any | null {
		let s = rawArgs

		if (!s || s.trim().length === 0) {
			return null
		}

		const trimTrailingComma = (str: string): string => str.replace(/,(\s*)$/, "$1")

		const completePrimitiveSuffix = (pb: string): string => {
			// Complete booleans/null prefixes
			if (/^(t|tr|tru)$/.test(pb)) return "e" // true
			if (/^(f|fa|fal|fals)$/.test(pb)) return "e" // false
			if (/^(n|nu|nul)$/.test(pb)) return "l" // null
			// Complete numeric partials like "-" or "12."
			if (/^-?$/.test(pb)) return "0"
			if (/^-?\d+\.$/.test(pb)) return "0"
			return ""
		}

		const stripIncompleteUnicodeAtEnd = (input: string): string => {
			const uniIndex = input.lastIndexOf("\\u")
			if (uniIndex !== -1) {
				const tail = input.slice(uniIndex + 2)
				if (!/^[0-9a-fA-F]{4}$/.test(tail)) {
					return input.slice(uniIndex) ? input.slice(0, uniIndex) : input
				}
			}
			return input
		}

		// 1) Handle in-flight strings
		if (state.inString) {
			// Drop dangling backslash to avoid invalid escape at buffer end
			if (s.endsWith("\\")) s = s.slice(0, -1)
			// Trim incomplete unicode escape (e.g. \u12)
			s = stripIncompleteUnicodeAtEnd(s)
			// Close the string
			s += `"`
		} else {
			// 2) Not inside a string; if a primitive token is partially accumulated, try to complete it minimally
			if (state.primitiveBuffer && state.primitiveBuffer.length > 0) {
				const suffix = completePrimitiveSuffix(state.primitiveBuffer)
				if (suffix) s += suffix
			}
		}

		// 3) Before closing brackets, remove trailing commas to avoid JSON syntax errors
		s = trimTrailingComma(s)

		// 4) Close any open objects/arrays per the current stack
		if (state.bracketStack.length > 0) {
			for (let i = state.bracketStack.length - 1; i >= 0; i--) {
				// Always ensure no trailing comma before we append a closer
				s = trimTrailingComma(s)

				const b = state.bracketStack[i]

				s += b === "{" ? "}" : "]"
			}
		}

		// 5) First parse attempt
		try {
			return JSON.parse(s)
		} catch {
			// 6) Second attempt: add one more null if still dangling and retry
			try {
				let s2 = s
				const lastNonWs = this.findLastNonWhitespaceChar(s2)
				if (lastNonWs === ":" || state.parserState === ParserState.EXPECT_VALUE) {
					s2 += "null"
				}
				s2 = trimTrailingComma(s2)
				return JSON.parse(s2)
			} catch {
				// 7) Final fallback: repeatedly trim trailing commas and retry
				let s3 = s
				for (let k = 0; k < 3; k++) {
					const trimmed = trimTrailingComma(s3)
					if (trimmed === s3) break
					s3 = trimmed
					try {
						return JSON.parse(s3)
					} catch {
						// continue
					}
				}
				return null
			}
		}
	}

	private findLastNonWhitespaceChar(str: string): string {
		for (let i = str.length - 1; i >= 0; i--) {
			const ch = str[i]
			if (!/\s/.test(ch)) return ch
		}
		return ""
	}

	private onOpenTag(tag: string, toolName: string): string {
		return `<${tag}>`
	}

	private onCloseTag(tag: string, toolName: string): string {
		return `</${tag}>\n`
	}
}

/**
 * A handler function that uses the StreamingToolCallProcessor to process streaming tool calls.
 * @param processor - An instance of StreamingToolCallProcessor.
 * @param chunk - The tool call chunk to process.
 * @param providerType - The type of tool call provider (e.g., OpenAI).
 * @returns The generated XML string.
 */
export const handleOpenaiToolCallStreaming = (
	processor: StreamingToolCallProcessor,
	chunk: any,
	providerType: ToolCallProviderType,
): ToolCallParam => {
	return processor.processChunkTool(chunk, providerType)
}
