import { parseJSON } from "partial-json"

import { type ToolName, toolNames, type FileEntry } from "@roo-code/types"
import { customToolRegistry } from "@roo-code/core"

import {
	type ToolUse,
	type McpToolUse,
	type ToolParamName,
	type NativeToolArgs,
	toolParamNames,
} from "../../shared/tools"
import { resolveToolAlias } from "../../shared/tool-aliases" // kilocode_change: prevent circular dependency
import type {
	ApiStreamToolCallStartChunk,
	ApiStreamToolCallDeltaChunk,
	ApiStreamToolCallEndChunk,
} from "../../api/transform/stream"
import { MCP_TOOL_PREFIX, MCP_TOOL_SEPARATOR, parseMcpToolName, normalizeMcpToolName } from "../../utils/mcp-name"

/**
 * Helper type to extract properly typed native arguments for a given tool.
 * Returns the type from NativeToolArgs if the tool is defined there, otherwise never.
 */
type NativeArgsFor<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : never

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 */
/**
 * Event types returned from raw chunk processing.
 */
export type ToolCallStreamEvent = ApiStreamToolCallStartChunk | ApiStreamToolCallDeltaChunk | ApiStreamToolCallEndChunk

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 *
 * This class also handles raw tool call chunk processing, converting
 * provider-level raw chunks into start/delta/end events.
 */
export class NativeToolCallParser {
	// Streaming state management for argument accumulation (keyed by tool call id)
	// Note: name is string to accommodate dynamic MCP tools (mcp--serverName--toolName)
	private static streamingToolCalls = new Map<
		string,
		{
			id: string
			name: string
			argumentsAccumulator: string
		}
	>()

	// Raw chunk tracking state (keyed by index from API stream)
	private static rawChunkTracker = new Map<
		number,
		{
			id: string
			name: string
			hasStarted: boolean
			deltaBuffer: string[]
		}
	>()

	private static coerceOptionalBoolean(value: unknown): boolean | undefined {
		if (typeof value === "boolean") {
			return value
		}
		if (typeof value === "string") {
			const lower = value.trim().toLowerCase()
			if (lower === "true") {
				return true
			}
			if (lower === "false") {
				return false
			}
		}
		return undefined
	}

	/**
	 * Process a raw tool call chunk from the API stream.
	 * Handles tracking, buffering, and emits start/delta/end events.
	 *
	 * This is the entry point for providers that emit tool_call_partial chunks.
	 * Returns an array of events to be processed by the consumer.
	 */
	public static processRawChunk(chunk: {
		index: number
		id?: string
		name?: string
		arguments?: string
	}): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []
		const { index, id, name, arguments: args } = chunk

		let tracked = this.rawChunkTracker.get(index)

		// Initialize new tool call tracking when we receive an id
		if (id && !tracked) {
			tracked = {
				id,
				name: name || "",
				hasStarted: false,
				deltaBuffer: [],
			}
			this.rawChunkTracker.set(index, tracked)
		}

		if (!tracked) {
			return events
		}

		// Update name if present in chunk and not yet set
		if (name) {
			tracked.name = name
		}

		// Emit start event when we have the name
		if (!tracked.hasStarted && tracked.name) {
			events.push({
				type: "tool_call_start",
				id: tracked.id,
				name: tracked.name,
			})
			tracked.hasStarted = true

			// Flush buffered deltas
			for (const bufferedDelta of tracked.deltaBuffer) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: bufferedDelta,
				})
			}
			tracked.deltaBuffer = []
		}

		// Emit delta event for argument chunks
		if (args) {
			if (tracked.hasStarted) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: args,
				})
			} else {
				tracked.deltaBuffer.push(args)
			}
		}

		return events
	}

	/**
	 * Process stream finish reason.
	 * Emits end events when finish_reason is 'tool_calls'.
	 */
	public static processFinishReason(finishReason: string | null | undefined): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (finishReason === "tool_calls" && this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				events.push({
					type: "tool_call_end",
					id: tracked.id,
				})
			}
		}

		return events
	}

	/**
	 * Finalize any remaining tool calls that weren't explicitly ended.
	 * Should be called at the end of stream processing.
	 */
	public static finalizeRawChunks(): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				if (tracked.hasStarted) {
					events.push({
						type: "tool_call_end",
						id: tracked.id,
					})
				}
			}
			this.rawChunkTracker.clear()
		}

		return events
	}

	/**
	 * Clear all raw chunk tracking state.
	 * Should be called when a new API request starts.
	 */
	public static clearRawChunkState(): void {
		this.rawChunkTracker.clear()
	}

	/**
	 * Start streaming a new tool call.
	 * Initializes tracking for incremental argument parsing.
	 * Accepts string to support both ToolName and dynamic MCP tools (mcp--serverName--toolName).
	 */
	public static startStreamingToolCall(id: string, name: string): void {
		this.streamingToolCalls.set(id, {
			id,
			name,
			argumentsAccumulator: "",
		})
	}

	/**
	 * Clear all streaming tool call state.
	 * Should be called when a new API request starts to prevent memory leaks
	 * from interrupted streams.
	 */
	public static clearAllStreamingToolCalls(): void {
		this.streamingToolCalls.clear()
	}

	/**
	 * Check if there are any active streaming tool calls.
	 * Useful for debugging and testing.
	 */
	public static hasActiveStreamingToolCalls(): boolean {
		return this.streamingToolCalls.size > 0
	}

	/**
	 * Process a chunk of JSON arguments for a streaming tool call.
	 * Uses partial-json-parser to extract values from incomplete JSON immediately.
	 * Returns a partial ToolUse with currently parsed parameters.
	 */
	public static processStreamingChunk(id: string, chunk: string): ToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			console.warn(`[NativeToolCallParser] Received chunk for unknown tool call: ${id}`)
			return null
		}

		// Accumulate the JSON string
		toolCall.argumentsAccumulator += chunk

		// For dynamic MCP tools, we don't return partial updates - wait for final
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
		if (toolCall.name.startsWith(mcpPrefix)) {
			return null
		}

		// Parse whatever we can from the incomplete JSON!
		// partial-json-parser extracts partial values (strings, arrays, objects) immediately
		try {
			const partialArgs = parseJSON(toolCall.argumentsAccumulator)

			// Resolve tool alias to canonical name
			const resolvedName = resolveToolAlias(toolCall.name) as ToolName
			// Preserve original name if it differs from resolved (i.e., it was an alias)
			const originalName = toolCall.name !== resolvedName ? toolCall.name : undefined

			// Create partial ToolUse with extracted values
			return this.createPartialToolUse(
				toolCall.id,
				resolvedName,
				partialArgs || {},
				true, // partial
				originalName,
			)
		} catch {
			// Even partial-json-parser can fail on severely malformed JSON
			// Return null and wait for next chunk
			return null
		}
	}

	/**
	 * Finalize a streaming tool call.
	 * Parses the complete JSON and returns the final ToolUse or McpToolUse.
	 */
	public static finalizeStreamingToolCall(id: string): ToolUse | McpToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			console.warn(`[NativeToolCallParser] Attempting to finalize unknown tool call: ${id}`)
			return null
		}

		// Parse the complete accumulated JSON
		// Cast to any for the name since parseToolCall handles both ToolName and dynamic MCP tools
		const finalToolUse = this.parseToolCall({
			id: toolCall.id,
			name: toolCall.name as ToolName,
			arguments: toolCall.argumentsAccumulator,
		})

		// Clean up streaming state
		this.streamingToolCalls.delete(id)

		return finalToolUse
	}

	private static coerceOptionalNumber(value: unknown): number | undefined {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value
		}
		if (typeof value === "string") {
			const n = Number(value)
			if (Number.isFinite(n)) {
				return n
			}
		}
		return undefined
	}

	/**
	 * Convert raw file entries from API (with line_ranges) to FileEntry objects
	 * (with lineRanges). Handles multiple formats for backward compatibility:
	 *
	 * New tuple format: { path: string, line_ranges: [[1, 50], [100, 150]] }
	 * Object format: { path: string, line_ranges: [{ start: 1, end: 50 }] }
	 * Legacy string format: { path: string, line_ranges: ["1-50"] }
	 *
	 * Returns: { path: string, lineRanges: [{ start: 1, end: 50 }] }
	 */
	private static convertFileEntries(files: unknown[]): FileEntry[] {
		return files.map((file: unknown) => {
			const f = file as Record<string, unknown>
			const entry: FileEntry = { path: f.path as string }
			if (f.line_ranges && Array.isArray(f.line_ranges)) {
				entry.lineRanges = (f.line_ranges as unknown[])
					.map((range: unknown) => {
						// Handle tuple format: [start, end]
						if (Array.isArray(range) && range.length >= 2) {
							return { start: Number(range[0]), end: Number(range[1]) }
						}
						// Handle object format: { start: number, end: number }
						if (typeof range === "object" && range !== null && "start" in range && "end" in range) {
							const r = range as { start: unknown; end: unknown }
							return { start: Number(r.start), end: Number(r.end) }
						}
						// Handle legacy string format: "1-50"
						if (typeof range === "string") {
							const match = range.match(/^(\d+)-(\d+)$/)
							if (match) {
								return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) }
							}
						}
						return null
					})
					.filter((r): r is { start: number; end: number } => r !== null)
			}
			return entry
		})
	}

	/**
	 * Create a partial ToolUse from currently parsed arguments.
	 * Used during streaming to show progress.
	 * @param originalName - The original tool name as called by the model (if different from canonical name)
	 */
	private static createPartialToolUse(
		id: string,
		name: ToolName,
		partialArgs: Record<string, any>,
		partial: boolean,
		originalName?: string,
	): ToolUse | null {
		// Build stringified params for display/partial-progress UI.
		// NOTE: For streaming partial updates, we MUST populate params even for complex types
		// because tool.handlePartial() methods rely on params to show UI updates.
		const params: Partial<Record<ToolParamName, string>> = {}

		for (const [key, value] of Object.entries(partialArgs)) {
			if (toolParamNames.includes(key as ToolParamName)) {
				params[key as ToolParamName] = typeof value === "string" ? value : JSON.stringify(value)
			}
		}

		// Build partial nativeArgs based on what we have so far
		let nativeArgs: any = undefined

		// Track if legacy format was used (for telemetry)
		let usedLegacyFormat = false

		switch (name) {
			case "read_file":
				// Check for legacy format first: { files: [...] }
				// Handle both array and stringified array (some models double-stringify)
				if (partialArgs.files !== undefined) {
					let filesArray: unknown[] | null = null

					if (Array.isArray(partialArgs.files)) {
						filesArray = partialArgs.files
					} else if (typeof partialArgs.files === "string") {
						// Handle double-stringified case: files is a string containing JSON array
						try {
							const parsed = JSON.parse(partialArgs.files)
							if (Array.isArray(parsed)) {
								filesArray = parsed
							}
						} catch {
							// Not valid JSON, ignore
						}
					}

					if (filesArray && filesArray.length > 0) {
						usedLegacyFormat = true
						nativeArgs = {
							files: this.convertFileEntries(filesArray),
							_legacyFormat: true as const,
						}
					}
				}
				// New format: { path: "...", mode: "..." }
				if (!nativeArgs && partialArgs.path !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						mode: partialArgs.mode,
						offset: this.coerceOptionalNumber(partialArgs.offset),
						limit: this.coerceOptionalNumber(partialArgs.limit),
						indentation:
							partialArgs.indentation && typeof partialArgs.indentation === "object"
								? {
										anchor_line: this.coerceOptionalNumber(partialArgs.indentation.anchor_line),
										max_levels: this.coerceOptionalNumber(partialArgs.indentation.max_levels),
										max_lines: this.coerceOptionalNumber(partialArgs.indentation.max_lines),
										include_siblings: this.coerceOptionalBoolean(
											partialArgs.indentation.include_siblings,
										),
										include_header: this.coerceOptionalBoolean(
											partialArgs.indentation.include_header,
										),
									}
								: undefined,
					}
				}
				break

			case "attempt_completion":
				if (partialArgs.result) {
					nativeArgs = { result: partialArgs.result }
				}
				break

			case "execute_command":
				if (partialArgs.command) {
					nativeArgs = {
						command: partialArgs.command,
						cwd: partialArgs.cwd,
					}
				}
				break

			case "write_to_file":
				if (partialArgs.path || partialArgs.content) {
					nativeArgs = {
						path: partialArgs.path,
						content: partialArgs.content,
					}
				}
				break

			case "ask_followup_question":
				if (partialArgs.question !== undefined || partialArgs.follow_up !== undefined) {
					nativeArgs = {
						question: partialArgs.question,
						follow_up: Array.isArray(partialArgs.follow_up) ? partialArgs.follow_up : undefined,
					}
				}
				break

			case "apply_diff":
				if (partialArgs.path !== undefined || partialArgs.diff !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						diff: partialArgs.diff,
					}
				}
				break

			case "browser_action":
				if (partialArgs.action !== undefined) {
					nativeArgs = {
						action: partialArgs.action,
						url: partialArgs.url,
						coordinate: partialArgs.coordinate,
						size: partialArgs.size,
						text: partialArgs.text,
						path: partialArgs.path,
					}
				}
				break

			case "codebase_search":
				if (partialArgs.query !== undefined) {
					nativeArgs = {
						query: partialArgs.query,
						path: partialArgs.path,
					}
				}
				break

			case "generate_image":
				if (partialArgs.prompt !== undefined || partialArgs.path !== undefined) {
					nativeArgs = {
						prompt: partialArgs.prompt,
						path: partialArgs.path,
						image: partialArgs.image,
					}
				}
				break

			case "run_slash_command":
				if (partialArgs.command !== undefined) {
					nativeArgs = {
						command: partialArgs.command,
						args: partialArgs.args,
					}
				}
				break

			case "skill":
				if (partialArgs.skill !== undefined) {
					nativeArgs = {
						skill: partialArgs.skill,
						args: partialArgs.args,
					}
				}
				break

			case "search_files":
				if (partialArgs.path !== undefined || partialArgs.regex !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						regex: partialArgs.regex,
						file_pattern: partialArgs.file_pattern,
					}
				}
				break

			case "switch_mode":
				if (partialArgs.mode_slug !== undefined || partialArgs.reason !== undefined) {
					nativeArgs = {
						mode_slug: partialArgs.mode_slug,
						reason: partialArgs.reason,
					}
				}
				break

			case "update_todo_list":
				if (partialArgs.todos !== undefined) {
					nativeArgs = {
						todos: partialArgs.todos,
					}
				}
				break

			case "use_mcp_tool":
				if (partialArgs.server_name !== undefined || partialArgs.tool_name !== undefined) {
					nativeArgs = {
						server_name: partialArgs.server_name,
						tool_name: partialArgs.tool_name,
						arguments: partialArgs.arguments,
					}
				}
				break

			case "apply_patch":
				if (partialArgs.patch !== undefined) {
					nativeArgs = {
						patch: partialArgs.patch,
					}
				}
				break

			case "search_replace":
				if (
					partialArgs.file_path !== undefined ||
					partialArgs.old_string !== undefined ||
					partialArgs.new_string !== undefined
				) {
					nativeArgs = {
						file_path: partialArgs.file_path,
						old_string: partialArgs.old_string,
						new_string: partialArgs.new_string,
					}
				}
				break

			case "search_and_replace":
				if (partialArgs.path !== undefined || partialArgs.operations !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						operations: partialArgs.operations,
					}
				}
				break

			case "edit_file":
				if (
					partialArgs.file_path !== undefined ||
					partialArgs.old_string !== undefined ||
					partialArgs.new_string !== undefined
				) {
					nativeArgs = {
						file_path: partialArgs.file_path,
						old_string: partialArgs.old_string,
						new_string: partialArgs.new_string,
						expected_replacements: partialArgs.expected_replacements,
					}
				}
				break

			case "list_files":
				if (partialArgs.path !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						recursive: this.coerceOptionalBoolean(partialArgs.recursive),
					}
				}
				break

			case "new_task":
				if (partialArgs.mode !== undefined || partialArgs.message !== undefined) {
					nativeArgs = {
						mode: partialArgs.mode,
						message: partialArgs.message,
						todos: partialArgs.todos,
					}
				}
				break

			default:
				break
		}

		const result: ToolUse = {
			type: "tool_use" as const,
			name,
			params,
			partial,
			nativeArgs,
		}

		// Preserve original name for API history when an alias was used
		if (originalName) {
			result.originalName = originalName
		}

		// Track legacy format usage for telemetry
		if (usedLegacyFormat) {
			result.usedLegacyFormat = true
		}

		return result
	}

	/**
	 * Convert a native tool call chunk to a ToolUse object.
	 *
	 * @param toolCall - The native tool call from the API stream
	 * @returns A properly typed ToolUse object
	 */
	public static parseToolCall<TName extends ToolName>(toolCall: {
		id: string
		name: TName
		arguments: string
	}): ToolUse<TName> | McpToolUse | null {
		// Check if this is a dynamic MCP tool (mcp--serverName--toolName)
		// Also handle models that output underscores instead of hyphens (mcp__serverName__toolName)
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR

		if (typeof toolCall.name === "string") {
			// Normalize the tool name to handle models that output underscores instead of hyphens
			const normalizedName = normalizeMcpToolName(toolCall.name)
			if (normalizedName.startsWith(mcpPrefix)) {
				// Pass the original tool call but with normalized name for parsing
				return this.parseDynamicMcpTool({ ...toolCall, name: normalizedName })
			}
		}

		// Resolve tool alias to canonical name
		const resolvedName = resolveToolAlias(toolCall.name as string) as TName

		// Validate tool name (after alias resolution).
		if (!toolNames.includes(resolvedName as ToolName) && !customToolRegistry.has(resolvedName)) {
			console.error(`Invalid tool name: ${toolCall.name} (resolved: ${resolvedName})`)
			console.error(`Valid tool names:`, toolNames)
			return null
		}

		try {
			// Parse the arguments JSON string
			const args = toolCall.arguments === "" ? {} : JSON.parse(toolCall.arguments)

			// Build stringified params for display/logging.
			// Tool execution MUST use nativeArgs (typed) and does not support legacy fallbacks.
			const params: Partial<Record<ToolParamName, string>> = {}

			for (const [key, value] of Object.entries(args)) {
				// Validate parameter name
				if (!toolParamNames.includes(key as ToolParamName) && !customToolRegistry.has(resolvedName)) {
					console.warn(`Unknown parameter '${key}' for tool '${resolvedName}'`)
					console.warn(`Valid param names:`, toolParamNames)
					continue
				}

				// Convert to string for legacy params format
				const stringValue = typeof value === "string" ? value : JSON.stringify(value)
				params[key as ToolParamName] = stringValue
			}

			// Build typed nativeArgs for tool execution.
			// Each case validates the minimum required parameters and constructs a properly typed
			// nativeArgs object. If validation fails, we treat the tool call as invalid and fail fast.
			let nativeArgs: NativeArgsFor<TName> | undefined = undefined

			// Track if legacy format was used (for telemetry)
			let usedLegacyFormat = false

			switch (resolvedName) {
				case "read_file":
					// Check for legacy format first: { files: [...] }
					// Handle both array and stringified array (some models double-stringify)
					if (args.files !== undefined) {
						let filesArray: unknown[] | null = null

						if (Array.isArray(args.files)) {
							filesArray = args.files
						} else if (typeof args.files === "string") {
							// Handle double-stringified case: files is a string containing JSON array
							try {
								const parsed = JSON.parse(args.files)
								if (Array.isArray(parsed)) {
									filesArray = parsed
								}
							} catch {
								// Not valid JSON, ignore
							}
						}

						if (filesArray && filesArray.length > 0) {
							usedLegacyFormat = true
							nativeArgs = {
								files: this.convertFileEntries(filesArray),
								_legacyFormat: true as const,
							} as NativeArgsFor<TName>
						}
					}
					// New format: { path: "...", mode: "..." }
					if (!nativeArgs && args.path !== undefined) {
						nativeArgs = {
							path: args.path,
							mode: args.mode,
							offset: this.coerceOptionalNumber(args.offset),
							limit: this.coerceOptionalNumber(args.limit),
							indentation:
								args.indentation && typeof args.indentation === "object"
									? {
											anchor_line: this.coerceOptionalNumber(args.indentation.anchor_line),
											max_levels: this.coerceOptionalNumber(args.indentation.max_levels),
											max_lines: this.coerceOptionalNumber(args.indentation.max_lines),
											include_siblings: this.coerceOptionalBoolean(
												args.indentation.include_siblings,
											),
											include_header: this.coerceOptionalBoolean(args.indentation.include_header),
										}
									: undefined,
						} as NativeArgsFor<TName>
					}
					break

				case "attempt_completion":
					if (args.result) {
						nativeArgs = { result: args.result } as NativeArgsFor<TName>
					}
					break

				case "execute_command":
					if (args.command) {
						nativeArgs = {
							command: args.command,
							cwd: args.cwd,
						} as NativeArgsFor<TName>
					}
					break

				// kilocode_change start
				// case "edit_file":
				case "condense":
				case "delete_file":
				case "new_rule":
				case "report_bug":
					break
				// kilocode_change end

				case "apply_diff":
					if (args.path !== undefined && args.diff !== undefined) {
						nativeArgs = {
							path: args.path,
							diff: args.diff,
						} as NativeArgsFor<TName>
					}
					break

				case "search_and_replace":
					if (args.path !== undefined && args.operations !== undefined && Array.isArray(args.operations)) {
						nativeArgs = {
							path: args.path,
							operations: args.operations,
						} as NativeArgsFor<TName>
					}
					break

				case "ask_followup_question":
					if (args.question !== undefined && args.follow_up !== undefined) {
						nativeArgs = {
							question: args.question,
							follow_up: args.follow_up,
						} as NativeArgsFor<TName>
					}
					break

				case "browser_action":
					if (args.action !== undefined) {
						nativeArgs = {
							action: args.action,
							url: args.url,
							coordinate: args.coordinate,
							size: args.size,
							text: args.text,
							path: args.path,
						} as NativeArgsFor<TName>
					}
					break

				case "codebase_search":
					if (args.query !== undefined) {
						nativeArgs = {
							query: args.query,
							path: args.path,
						} as NativeArgsFor<TName>
					}
					break

				case "generate_image":
					if (args.prompt !== undefined && args.path !== undefined) {
						nativeArgs = {
							prompt: args.prompt,
							path: args.path,
							image: args.image,
						} as NativeArgsFor<TName>
					}
					break

				case "run_slash_command":
					if (args.command !== undefined) {
						nativeArgs = {
							command: args.command,
							args: args.args,
						} as NativeArgsFor<TName>
					}
					break

				case "skill":
					if (args.skill !== undefined) {
						nativeArgs = {
							skill: args.skill,
							args: args.args,
						} as NativeArgsFor<TName>
					}
					break

				case "search_files":
					if (args.path !== undefined && args.regex !== undefined) {
						nativeArgs = {
							path: args.path,
							regex: args.regex,
							file_pattern: args.file_pattern,
						} as NativeArgsFor<TName>
					}
					break

				case "switch_mode":
					if (args.mode_slug !== undefined && args.reason !== undefined) {
						nativeArgs = {
							mode_slug: args.mode_slug,
							reason: args.reason,
						} as NativeArgsFor<TName>
					}
					break

				case "update_todo_list":
					if (args.todos !== undefined) {
						nativeArgs = {
							todos: args.todos,
						} as NativeArgsFor<TName>
					}
					break

				case "read_command_output":
					if (args.artifact_id !== undefined) {
						nativeArgs = {
							artifact_id: args.artifact_id,
							search: args.search,
							offset: args.offset,
							limit: args.limit,
						} as NativeArgsFor<TName>
					}
					break

				case "write_to_file":
					if (args.path !== undefined && args.content !== undefined) {
						nativeArgs = {
							path: args.path,
							content: args.content,
						} as NativeArgsFor<TName>
					}
					break

				case "use_mcp_tool":
					if (args.server_name !== undefined && args.tool_name !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							tool_name: args.tool_name,
							arguments: args.arguments,
						} as NativeArgsFor<TName>
					}
					break

				case "access_mcp_resource":
					if (args.server_name !== undefined && args.uri !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							uri: args.uri,
						} as NativeArgsFor<TName>
					}
					break

				case "apply_patch":
					if (args.patch !== undefined) {
						nativeArgs = {
							patch: args.patch,
						} as NativeArgsFor<TName>
					}
					break

				case "search_replace":
					if (
						args.file_path !== undefined &&
						args.old_string !== undefined &&
						args.new_string !== undefined
					) {
						nativeArgs = {
							file_path: args.file_path,
							old_string: args.old_string,
							new_string: args.new_string,
						} as NativeArgsFor<TName>
					}
					break

				case "edit_file":
					if (
						args.file_path !== undefined &&
						args.old_string !== undefined &&
						args.new_string !== undefined
					) {
						nativeArgs = {
							file_path: args.file_path,
							old_string: args.old_string,
							new_string: args.new_string,
							expected_replacements: args.expected_replacements,
						} as NativeArgsFor<TName>
					}
					break

				case "list_files":
					if (args.path !== undefined) {
						nativeArgs = {
							path: args.path,
							recursive: this.coerceOptionalBoolean(args.recursive),
						} as NativeArgsFor<TName>
					}
					break

				case "new_task":
					if (args.mode !== undefined && args.message !== undefined) {
						nativeArgs = {
							mode: args.mode,
							message: args.message,
							todos: args.todos,
						} as NativeArgsFor<TName>
					}
					break

				default:
					if (customToolRegistry.has(resolvedName)) {
						nativeArgs = args as NativeArgsFor<TName>
					}

					break
			}

			// Native-only: core tools must always have typed nativeArgs.
			// If we couldn't construct it, the model produced an invalid tool call payload.
			if (!nativeArgs && !customToolRegistry.has(resolvedName)) {
				throw new Error(
					`[NativeToolCallParser] Invalid arguments for tool '${resolvedName}'. ` +
						`Native tool calls require a valid JSON payload matching the tool schema. ` +
						`Received: ${JSON.stringify(args)}`,
				)
			}

			const result: ToolUse<TName> = {
				type: "tool_use" as const,
				name: resolvedName,
				params,
				partial: false, // Native tool calls are always complete when yielded
				nativeArgs,
			}

			// Preserve original name for API history when an alias was used
			if (toolCall.name !== resolvedName) {
				result.originalName = toolCall.name
			}

			// Track legacy format usage for telemetry
			if (usedLegacyFormat) {
				result.usedLegacyFormat = true
			}

			return result
		} catch (error) {
			console.error(
				`Failed to parse tool call arguments: ${error instanceof Error ? error.message : String(error)}`,
			)

			console.error(`Tool call: ${JSON.stringify(toolCall, null, 2)}`)
			return null
		}
	}

	/**
	 * Parse dynamic MCP tools (named mcp--serverName--toolName).
	 * These are generated dynamically by getMcpServerTools() and are returned
	 * as McpToolUse objects that preserve the original tool name.
	 */
	public static parseDynamicMcpTool(toolCall: { id: string; name: string; arguments: string }): McpToolUse | null {
		try {
			// Parse the arguments - these are the actual tool arguments passed directly
			const args = JSON.parse(toolCall.arguments || "{}")

			// Normalize the tool name to handle models that output underscores instead of hyphens
			// e.g., mcp__serverName__toolName -> mcp--serverName--toolName
			const normalizedName = normalizeMcpToolName(toolCall.name)

			// Extract server_name and tool_name from the tool name itself
			// Format: mcp--serverName--toolName (using -- separator)
			const parsed = parseMcpToolName(normalizedName)
			if (!parsed) {
				console.error(`Invalid dynamic MCP tool name format: ${toolCall.name} (normalized: ${normalizedName})`)
				return null
			}

			const { serverName, toolName } = parsed

			const result: McpToolUse = {
				type: "mcp_tool_use" as const,
				id: toolCall.id,
				// Keep the original tool name (e.g., "mcp--serverName--toolName") for API history
				name: toolCall.name,
				serverName,
				toolName,
				arguments: args,
				partial: false,
			}

			return result
		} catch (error) {
			console.error(`Failed to parse dynamic MCP tool:`, error)
			return null
		}
	}
}
