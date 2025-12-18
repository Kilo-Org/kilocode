import { Task } from "../task/Task"
import type {
	ToolUse,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	AskApproval,
	NativeToolArgs,
} from "../../shared/tools"
import type { ToolName, ToolProtocol } from "@roo-code/types"

/**
 * Callbacks passed to tool execution
 */
export interface ToolCallbacks {
	askApproval: AskApproval
	handleError: HandleError
	pushToolResult: PushToolResult
	removeClosingTag: RemoveClosingTag
	toolProtocol: ToolProtocol
	toolCallId?: string
}

/**
 * Helper type to extract the parameter type for a tool based on its name.
 * If the tool has native args defined in NativeToolArgs, use those; otherwise fall back to any.
 */
type ToolParams<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : any

/**
 * Abstract base class for all tools.
 *
 * Provides a consistent architecture where:
 * - XML/legacy protocol: params → parseLegacy() → typed params → execute()
 * - Native protocol: nativeArgs already contain typed data → execute()
 *
 * Each tool extends this class and implements:
 * - parseLegacy(): Convert XML/legacy string params to typed params
 * - execute(): Protocol-agnostic core logic using typed params
 * - handlePartial(): (optional) Handle streaming partial messages
 *
 * @template TName - The specific tool name, which determines native arg types
 */
export abstract class BaseTool<TName extends ToolName> {
	/**
	 * The tool's name (must match ToolName type)
	 */
	abstract readonly name: TName

	/**
	 * Parse XML/legacy string-based parameters into typed parameters.
	 *
	 * For XML protocol, this converts params.args (XML string) or params.path (legacy)
	 * into a typed structure that execute() can use.
	 *
	 * @param params - Raw ToolUse.params from XML protocol
	 * @returns Typed parameters for execute()
	 * @throws Error if parsing fails
	 */
	abstract parseLegacy(params: Partial<Record<string, string>>): ToolParams<TName>

	/**
	 * Execute the tool with typed parameters.
	 *
	 * This is the protocol-agnostic core logic. It receives typed parameters
	 * (from parseLegacy for XML, or directly from native protocol) and performs
	 * the tool's operation.
	 *
	 * @param params - Typed parameters
	 * @param task - Task instance with state and API access
	 * @param callbacks - Tool execution callbacks (approval, error handling, results)
	 */
	abstract execute(params: ToolParams<TName>, task: Task, callbacks: ToolCallbacks): Promise<void>

	/**
	 * Handle partial (streaming) tool messages.
	 *
	 * Default implementation does nothing. Tools that support streaming
	 * partial messages should override this.
	 *
	 * @param task - Task instance
	 * @param block - Partial ToolUse block
	 */
	async handlePartial(task: Task, block: ToolUse<TName>): Promise<void> {
		// Default: no-op for partial messages
		// Tools can override to show streaming UI updates
	}

	/**
	 * Remove partial closing XML tags from text during streaming.
	 *
	 * This utility helps clean up partial XML tag artifacts that can appear
	 * at the end of streamed content, preventing them from being displayed to users.
	 *
	 * @param tag - The tag name to check for partial closing
	 * @param text - The text content to clean
	 * @param isPartial - Whether this is a partial message (if false, returns text as-is)
	 * @returns Cleaned text with partial closing tags removed
	 */
	protected removeClosingTag(tag: string, text: string | undefined, isPartial: boolean): string {
		if (!isPartial) {
			return text || ""
		}

		if (!text) {
			return ""
		}

		// This regex dynamically constructs a pattern to match the closing tag:
		// - Optionally matches whitespace before the tag
		// - Matches '<' or '</' optionally followed by any subset of characters from the tag name
		const tagRegex = new RegExp(
			`\\s?<\/?${tag
				.split("")
				.map((char) => `(?:${char})?`)
				.join("")}$`,
			"g",
		)

		return text.replace(tagRegex, "")
	}

	/**
	 * Main entry point for tool execution.
	 *
	 * Handles the complete flow:
	 * 1. Partial message handling (if partial)
	 * 2. Parameter parsing (parseLegacy for XML, or use nativeArgs directly)
	 * 3. Core execution (execute)
	 *
	 * @param task - Task instance
	 * @param block - ToolUse block from assistant message
	 * @param callbacks - Tool execution callbacks
	 */
	async handle(task: Task, block: ToolUse<TName>, callbacks: ToolCallbacks): Promise<void> {
		// Handle partial messages
		if (block.partial) {
			try {
				await this.handlePartial(task, block)
			} catch (error) {
				console.error(`Error in handlePartial:`, error)
				await callbacks.handleError(
					`handling partial ${this.name}`,
					error instanceof Error ? error : new Error(String(error)),
				)
			}
			return
		}

		// Determine protocol and parse parameters accordingly
		let params: ToolParams<TName>
		try {
			if (block.nativeArgs !== undefined) {
				// Native protocol: typed args provided by NativeToolCallParser
				// TypeScript knows nativeArgs is properly typed based on TName
				params = block.nativeArgs as ToolParams<TName>
			} else {
				// XML/legacy protocol: parse string params into typed params
				params = this.parseLegacy(block.params)
			}
		} catch (error) {
			console.error(`Error parsing parameters:`, error)
			const errorMessage = `Failed to parse ${this.name} parameters: ${error instanceof Error ? error.message : String(error)}`
			await callbacks.handleError(`parsing ${this.name} args`, new Error(errorMessage))
			callbacks.pushToolResult(`<error>${errorMessage}</error>`)
			return
		}

		// Execute with typed parameters
		await this.execute(params, task, callbacks)
	}
}
