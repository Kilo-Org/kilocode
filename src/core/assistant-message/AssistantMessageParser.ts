import { type ToolName, toolNames } from "@roo-code/types"
import { TextContent, ToolUse, ToolParamName, toolParamNames } from "../../shared/tools"
import { AssistantMessageContent } from "./parseAssistantMessage"
import { extractMcpToolInfo, NativeToolCall } from "./kilocode/native-tool-call"
import Anthropic from "@anthropic-ai/sdk" // kilocode_change

/**
 * Parser for assistant messages. Maintains state between chunks
 * to avoid reprocessing the entire message on each update.
 */
export class AssistantMessageParser {
	private contentBlocks: AssistantMessageContent[] = []
	private currentTextContent: TextContent | undefined = undefined
	private currentTextContentStartIndex = 0
	private currentToolUse: ToolUse | undefined = undefined
	private currentToolUseStartIndex = 0
	private currentParamName: ToolParamName | undefined = undefined
	private currentParamValueStartIndex = 0
	private readonly MAX_ACCUMULATOR_SIZE = 1024 * 1024 // 1MB limit
	private readonly MAX_PARAM_LENGTH = 1024 * 100 // 100KB per parameter limit

	// kilocode_change start
	// State for accumulating native tool calls
	private nativeToolCallsAccumulator: Map<string, NativeToolCall> = new Map()
	private processedNativeToolCallIds: Set<string> = new Set()
	// Map index to id for tracking across streaming deltas
	private nativeToolCallIndexToId: Map<number, string> = new Map()
	// kilocode_change end

	private accumulator = ""

	/**
	 * Initialize a new AssistantMessageParser instance.
	 */
	constructor() {
		this.reset()
	}

	/**
	 * Reset the parser state.
	 */
	public reset(): void {
		this.contentBlocks = []
		this.currentTextContent = undefined
		this.currentTextContentStartIndex = 0
		this.currentToolUse = undefined
		this.currentToolUseStartIndex = 0
		this.currentParamName = undefined
		this.currentParamValueStartIndex = 0
		this.accumulator = ""

		// kilocode_change start
		this.nativeToolCallsAccumulator.clear()
		this.processedNativeToolCallIds.clear()
		this.nativeToolCallIndexToId.clear()
		// kilocode_change end
	}

	/**
	 * Returns the current parsed content blocks
	 */

	public getContentBlocks(): AssistantMessageContent[] {
		// Return a shallow copy to prevent external mutation
		return this.contentBlocks.slice()
	}

	// kilocode_change start
	/**
	 * Process native OpenAI-format tool calls and convert them to internal ToolUse format.
	 * This handles tool calls that come from OpenAI-compatible APIs in their native format
	 * rather than embedded as XML in text content.
	 *
	 * Native tool calls stream in as deltas, so this method accumulates them until complete.
	 *
	 * @param toolCalls Array of native tool call objects (may be partial during streaming).  We
	 * currently set parallel_tool_calls to false, so in theory there should only be 1 call.
	 */
	public *processNativeToolCalls(toolCalls: NativeToolCall[]): Generator<Anthropic.ToolUseBlockParam> {
		for (const toolCall of toolCalls) {
			// Determine the tracking key
			// If we have an index, use that to look up or store the id
			// Otherwise use the id directly (for non-streaming or first delta)
			let toolCallId: string

			if (toolCall.index !== undefined) {
				// Check if we've seen this index before
				const existingId = this.nativeToolCallIndexToId.get(toolCall.index)
				if (existingId) {
					toolCallId = existingId
				} else if (toolCall.id) {
					// First time seeing this index with an id - store the mapping
					toolCallId = toolCall.id
					this.nativeToolCallIndexToId.set(toolCall.index, toolCallId)
				} else {
					console.warn(
						"[AssistantMessageParser] Skipping tool call: has index but no id in mapping:",
						toolCall,
					)
					continue
				}
			} else if (toolCall.id) {
				toolCallId = toolCall.id
			} else {
				console.warn("[AssistantMessageParser] Skipping tool call without index or ID:", toolCall)
				continue
			}

			// Check if we've already processed this tool call
			if (this.processedNativeToolCallIds.has(toolCallId)) {
				console.log("[AssistantMessageParser] Tool call already processed:", toolCallId)
				continue
			}

			// Get or create the accumulator entry for this tool call
			let accumulatedCall = this.nativeToolCallsAccumulator.get(toolCallId)

			// First delta: has function name (initialize accumulator)
			if (toolCall.function?.name) {
				const toolName = toolCall.function.name

				// Check if it's a dynamic MCP tool or a recognized static tool name
				const mcpToolInfo = extractMcpToolInfo(toolName)
				const isValidTool = mcpToolInfo !== null || toolNames.includes(toolName as ToolName)

				if (!isValidTool) {
					console.warn("[AssistantMessageParser] Unknown tool name in native call:", toolName)
					continue
				}

				if (!accumulatedCall) {
					accumulatedCall = {
						id: toolCall.id,
						type: toolCall.type,
						function: {
							name: toolCall.function.name,
							arguments: toolCall.function.arguments || "",
						},
					}
					this.nativeToolCallsAccumulator.set(toolCallId, accumulatedCall)
				} else {
					// Shouldn't happen, but append arguments if it does
					accumulatedCall.function!.arguments += toolCall.function.arguments || ""
				}
			}
			// Subsequent deltas: only have arguments (append to existing accumulator)
			else if (accumulatedCall) {
				accumulatedCall.function!.arguments += toolCall.function?.arguments || ""
			}
			// Got arguments without ever getting a name - shouldn't happen
			else {
				console.warn("[AssistantMessageParser] Received arguments for unknown tool call:", toolCallId)
				continue
			}

			// Only try to parse if we have an accumulator (shouldn't be undefined at this point)
			if (!accumulatedCall) {
				continue
			}

			// Try to parse the arguments - if successful, the tool call is complete
			let isComplete = false
			let parsedArgs: Record<string, any> = {}

			try {
				if (accumulatedCall.function!.arguments.trim()) {
					parsedArgs = JSON.parse(accumulatedCall.function!.arguments)
					isComplete = true
				}
			} catch (error) {
				// Arguments are not yet complete valid JSON, continue accumulating
				continue
			}

			// Tool call is complete - convert it to ToolUse format
			if (isComplete) {
				const toolName = accumulatedCall.function!.name

				// Finalize any current text content before adding tool use
				if (this.currentTextContent) {
					this.currentTextContent.partial = false
					this.currentTextContent = undefined
				}

				// Normalize dynamic MCP tool names to "use_mcp_tool"
				// Dynamic tools have format: use_mcp_tool_{serverName}_{toolName}
				const mcpToolInfo = extractMcpToolInfo(toolName)
				let normalizedToolName: ToolName
				let normalizedParams = parsedArgs

				if (mcpToolInfo) {
					// Dynamic MCP tool - normalize to "use_mcp_tool"
					// Tool name format: use_mcp_tool___{serverName}___{toolName}
					normalizedToolName = "use_mcp_tool"

					// Extract toolInputProps and convert to JSON string for the arguments parameter
					// The model provides: { server_name, tool_name, toolInputProps: {...actual args...} }
					// We need: { server_name, tool_name, arguments: "{...actual args as JSON string...}" }
					const toolInputProps = (parsedArgs as any).toolInputProps || {}
					const argumentsJson = JSON.stringify(toolInputProps)

					// Add server_name, tool_name, and arguments to params
					normalizedParams = {
						server_name: parsedArgs.server_name || mcpToolInfo.serverName,
						tool_name: parsedArgs.tool_name || mcpToolInfo.toolName,
						arguments: argumentsJson,
					}
				} else {
					// Standard tool
					normalizedToolName = toolName as ToolName
				}

				// Create a ToolUse block from the native tool call
				const toolUse: ToolUse = {
					type: "tool_use",
					name: normalizedToolName,
					params: normalizedParams,
					partial: false, // Now complete after accumulation
					toolUseId: accumulatedCall.id,
				}

				// Add the tool use to content blocks
				this.contentBlocks.push(toolUse)

				// Mark this tool call as processed
				this.processedNativeToolCallIds.add(toolCallId)
				this.nativeToolCallsAccumulator.delete(toolCallId)

				yield {
					type: "tool_use",
					name: toolUse.name,
					id: toolUse.toolUseId ?? "",
					input: toolUse.params,
				}
			}
		}
	}

	// kilocode_change end

	/**
	 * Process a new chunk of text and update the parser state.
	 * @param chunk The new chunk of text to process.
	 */
	public processChunk(chunk: string): AssistantMessageContent[] {
		if (this.accumulator.length + chunk.length > this.MAX_ACCUMULATOR_SIZE) {
			throw new Error("Assistant message exceeds maximum allowed size")
		}
		// Store the current length of the accumulator before adding the new chunk
		const accumulatorStartLength = this.accumulator.length

		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i]
			this.accumulator += char
			const currentPosition = accumulatorStartLength + i

			// There should not be a param without a tool use.
			if (this.currentToolUse && this.currentParamName) {
				const currentParamValue = this.accumulator.slice(this.currentParamValueStartIndex)
				if (currentParamValue.length > this.MAX_PARAM_LENGTH) {
					// Reset to a safe state
					this.currentParamName = undefined
					this.currentParamValueStartIndex = 0
					continue
				}
				const paramClosingTag = `</${this.currentParamName}>`
				// Streamed param content: always write the currently accumulated value
				if (currentParamValue.endsWith(paramClosingTag)) {
					// End of param value.
					// Do not trim content parameters to preserve newlines, but strip first and last newline only
					const paramValue = currentParamValue.slice(0, -paramClosingTag.length)
					this.currentToolUse.params[this.currentParamName] =
						this.currentParamName === "content"
							? paramValue.replace(/^\n/, "").replace(/\n$/, "")
							: paramValue.trim()
					this.currentParamName = undefined
					continue
				} else {
					// Partial param value is accumulating.
					// Write the currently accumulated param content in real time
					this.currentToolUse.params[this.currentParamName] = currentParamValue
					continue
				}
			}

			// No currentParamName.

			if (this.currentToolUse) {
				const currentToolValue = this.accumulator.slice(this.currentToolUseStartIndex)
				const toolUseClosingTag = `</${this.currentToolUse.name}>`
				if (currentToolValue.endsWith(toolUseClosingTag)) {
					// End of a tool use.
					this.currentToolUse.partial = false

					this.currentToolUse = undefined
					continue
				} else {
					const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)
					for (const paramOpeningTag of possibleParamOpeningTags) {
						if (this.accumulator.endsWith(paramOpeningTag)) {
							// Start of a new parameter.
							const paramName = paramOpeningTag.slice(1, -1)
							if (!toolParamNames.includes(paramName as ToolParamName)) {
								// Handle invalid parameter name gracefully
								continue
							}
							this.currentParamName = paramName as ToolParamName
							this.currentParamValueStartIndex = this.accumulator.length
							break
						}
					}

					// There's no current param, and not starting a new param.

					// Special case for write_to_file where file contents could
					// contain the closing tag, in which case the param would have
					// closed and we end up with the rest of the file contents here.
					// To work around this, get the string between the starting
					// content tag and the LAST content tag.
					const contentParamName: ToolParamName = "content"

					if (
						this.currentToolUse.name === "write_to_file" &&
						this.accumulator.endsWith(`</${contentParamName}>`)
					) {
						const toolContent = this.accumulator.slice(this.currentToolUseStartIndex)
						const contentStartTag = `<${contentParamName}>`
						const contentEndTag = `</${contentParamName}>`
						const contentStartIndex = toolContent.indexOf(contentStartTag) + contentStartTag.length
						const contentEndIndex = toolContent.lastIndexOf(contentEndTag)

						if (contentStartIndex !== -1 && contentEndIndex !== -1 && contentEndIndex > contentStartIndex) {
							// Don't trim content to preserve newlines, but strip first and last newline only
							this.currentToolUse.params[contentParamName] = toolContent
								.slice(contentStartIndex, contentEndIndex)
								.replace(/^\n/, "")
								.replace(/\n$/, "")
						}
					}

					// Partial tool value is accumulating.
					continue
				}
			}

			// No currentToolUse.

			let didStartToolUse = false
			const possibleToolUseOpeningTags = toolNames.map((name) => `<${name}>`)

			for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
				if (this.accumulator.endsWith(toolUseOpeningTag)) {
					// Extract and validate the tool name
					const extractedToolName = toolUseOpeningTag.slice(1, -1)

					// Check if the extracted tool name is valid
					if (!toolNames.includes(extractedToolName as ToolName)) {
						// Invalid tool name, treat as plain text and continue
						continue
					}

					// Start of a new tool use.
					this.currentToolUse = {
						type: "tool_use",
						name: extractedToolName as ToolName,
						params: {},
						partial: true,
					}

					this.currentToolUseStartIndex = this.accumulator.length

					// This also indicates the end of the current text content.
					if (this.currentTextContent) {
						this.currentTextContent.partial = false

						// Remove the partially accumulated tool use tag from the
						// end of text (<tool).
						this.currentTextContent.content = this.currentTextContent.content
							.slice(0, -toolUseOpeningTag.slice(0, -1).length)
							.trim()

						// No need to push, currentTextContent is already in contentBlocks
						this.currentTextContent = undefined
					}

					// Immediately push new tool_use block as partial
					let idx = this.contentBlocks.findIndex((block) => block === this.currentToolUse)
					if (idx === -1) {
						this.contentBlocks.push(this.currentToolUse)
					}

					didStartToolUse = true
					break
				}
			}

			if (!didStartToolUse) {
				// No tool use, so it must be text either at the beginning or
				// between tools.
				if (this.currentTextContent === undefined) {
					// If this is the first chunk and we're at the beginning of processing,
					// set the start index to the current position in the accumulator
					this.currentTextContentStartIndex = currentPosition

					// Create a new text content block and add it to contentBlocks
					this.currentTextContent = {
						type: "text",
						content: this.accumulator.slice(this.currentTextContentStartIndex).trim(),
						partial: true,
					}

					// Add the new text content to contentBlocks immediately
					// Ensures it appears in the UI right away
					this.contentBlocks.push(this.currentTextContent)
				} else {
					// Update the existing text content
					this.currentTextContent.content = this.accumulator.slice(this.currentTextContentStartIndex).trim()
				}
			}
		}
		// Do not call finalizeContentBlocks() here.
		// Instead, update any partial blocks in the array and add new ones as they're completed.
		// This matches the behavior of the original parseAssistantMessage function.
		return this.getContentBlocks()
	}

	/**
	 * Finalize any partial content blocks.
	 * Should be called after processing the last chunk.
	 */
	public finalizeContentBlocks(): void {
		// Mark all partial blocks as complete
		for (const block of this.contentBlocks) {
			if (block.partial) {
				block.partial = false
			}
			if (block.type === "text" && typeof block.content === "string") {
				block.content = block.content.trim()
			}
		}
	}
}
