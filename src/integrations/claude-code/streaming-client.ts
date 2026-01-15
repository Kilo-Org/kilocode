import type { Anthropic } from "@anthropic-ai/sdk"
import type { ClaudeCodeRateLimitInfo } from "@roo-code/types"
import { Package } from "../../shared/package"

/**
 * Set of content block types that are valid for Anthropic API.
 * Only these types will be passed through to the API.
 * See: https://docs.anthropic.com/en/api/messages
 */
const VALID_ANTHROPIC_BLOCK_TYPES = new Set([
	"text",
	"image",
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
	"document",
])

type ContentBlockWithType = { type: string }

/**
 * Filters out non-Anthropic content blocks from messages before sending to the API.
 *
 * NOTE: This function performs FILTERING ONLY - no type conversion is performed.
 * Blocks are either kept as-is or removed entirely based on the allowlist.
 *
 * Uses an allowlist approach - only blocks with types in VALID_ANTHROPIC_BLOCK_TYPES are kept.
 * This automatically filters out:
 * - Internal "reasoning" blocks (Roo Code's internal representation) - NOT converted to "thinking"
 * - Gemini's "thoughtSignature" blocks
 * - Any other unknown block types
 *
 * IMPORTANT: This function also strips message-level fields that are not part of the Anthropic API:
 * - `reasoning_details` (added by OpenRouter/Roo providers for Gemini/OpenAI reasoning)
 * - Any other non-standard fields added by other providers
 *
 * We preserve ALL "thinking" blocks (Anthropic's native extended thinking format) for these reasons:
 * 1. Rewind functionality - users need to be able to go back in conversation history
 * 2. Claude Opus 4.5+ preserves thinking blocks by default (per Anthropic docs)
 * 3. Interleaved thinking requires thinking blocks to be passed back for tool use continuations
 *
 * The API will handle thinking blocks appropriately based on the model:
 * - Claude Opus 4.5+: thinking blocks preserved (enables cache optimization)
 * - Older models: thinking blocks stripped from prior turns automatically
 */
function filterNonAnthropicBlocks(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
	const result: Anthropic.Messages.MessageParam[] = []

	for (const message of messages) {
		// Extract ONLY the standard Anthropic message fields (role, content)
		// This strips out any extra fields like `reasoning_details` that other providers
		// may have added to the messages (e.g., OpenRouter adds reasoning_details for Gemini/o-series)
		const { role, content } = message

		if (typeof content === "string") {
			// Return a clean message with only role and content
			result.push({ role, content })
			continue
		}

		// Filter out invalid block types (allowlist)
		const filteredContent = content.filter((block) =>
			VALID_ANTHROPIC_BLOCK_TYPES.has((block as ContentBlockWithType).type),
		)

		// If all content was filtered out, skip this message
		if (filteredContent.length === 0) {
			continue
		}

		// Return a clean message with only role and content (no extra fields)
		result.push({
			role,
			content: filteredContent,
		})
	}

	return result
}

/**
 * Adds cache_control breakpoints to the last two user messages for prompt caching.
 * This follows Anthropic's recommended pattern:
 * - Cache the system prompt (handled separately)
 * - Cache the last text block of the second-to-last user message
 * - Cache the last text block of the last user message
 *
 * According to Anthropic docs:
 * - System prompts and tools remain cached despite thinking parameter changes
 * - Message cache breakpoints are invalidated when thinking parameters change
 * - When using extended thinking, thinking blocks from previous turns are stripped from context
 */
function addMessageCacheBreakpoints(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
	// Find indices of user messages
	const userMsgIndices = messages.reduce(
		(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
		[] as number[],
	)

	const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
	const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

	return messages.map((message, index) => {
		// Only add cache control to the last two user messages
		if (index !== lastUserMsgIndex && index !== secondLastUserMsgIndex) {
			return message
		}

		// Handle string content
		if (typeof message.content === "string") {
			return {
				...message,
				content: [
					{
						type: "text" as const,
						text: message.content,
						cache_control: { type: "ephemeral" as const },
					},
				],
			}
		}

		// Handle array content - add cache_control to the last text block
		const contentWithCache = message.content.map((block, blockIndex) => {
			// Find the last text block index
			let lastTextIndex = -1
			for (let i = message.content.length - 1; i >= 0; i--) {
				if ((message.content[i] as { type: string }).type === "text") {
					lastTextIndex = i
					break
				}
			}

			// Only add cache_control to text blocks (the last one specifically)
			if (blockIndex === lastTextIndex && (block as { type: string }).type === "text") {
				const textBlock = block as { type: "text"; text: string }
				return {
					type: "text" as const,
					text: textBlock.text,
					cache_control: { type: "ephemeral" as const },
				}
			}

			return block
		})

		return {
			...message,
			content: contentWithCache,
		}
	})
}

// API Configuration
export const CLAUDE_CODE_API_CONFIG = {
	endpoint: "https://api.anthropic.com/v1/messages",
	version: "2023-06-01",
	defaultBetas: [
		"prompt-caching-2024-07-31",
		"claude-code-20250219",
		"oauth-2025-04-20",
		"interleaved-thinking-2025-05-14",
		"fine-grained-tool-streaming-2025-05-14",
	],
	userAgent: `Roo-Code/${Package.version}`,
} as const

/**
 * SSE Event types from Anthropic streaming API
 */
export type SSEEventType =
	| "message_start"
	| "content_block_start"
	| "content_block_delta"
	| "content_block_stop"
	| "message_delta"
	| "message_stop"
	| "ping"
	| "error"

export interface SSEEvent {
	event: SSEEventType
	data: unknown
}

/**
 * Thinking configuration for extended thinking mode
 */
export type ThinkingConfig =
	| {
			type: "enabled"
			budget_tokens: number
	  }
	| {
			type: "disabled"
	  }

/**
 * Stream message request options
 */
export interface StreamMessageOptions {
	accessToken: string
	model: string
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	maxTokens?: number
	thinking?: ThinkingConfig
	tools?: Anthropic.Messages.Tool[]
	toolChoice?: Anthropic.Messages.ToolChoice
	metadata?: {
		user_id?: string
	}
	signal?: AbortSignal
}

/**
 * SSE Parser state that persists across chunks
 * This is necessary because SSE events can be split across multiple chunks
 */
interface SSEParserState {
	buffer: string
	currentEvent: string | null
	currentData: string[]
}

/**
 * Creates initial SSE parser state
 */
function createSSEParserState(): SSEParserState {
	return {
		buffer: "",
		currentEvent: null,
		currentData: [],
	}
}

/**
 * Parses SSE lines from a text chunk
 * Returns parsed events and updates the state for the next chunk
 *
 * The state persists across chunks to handle events that span multiple chunks:
 * - buffer: incomplete line from previous chunk
 * - currentEvent: event type if we've seen "event:" but not the complete event
 * - currentData: accumulated data lines for the current event
 */
function parseSSEChunk(chunk: string, state: SSEParserState): { events: SSEEvent[]; state: SSEParserState } {
	const events: SSEEvent[] = []
	const lines = (state.buffer + chunk).split("\n")

	// Start with the accumulated state
	let currentEvent = state.currentEvent
	let currentData = [...state.currentData]
	let remaining = ""

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		// If this is the last line and doesn't end with newline, it might be incomplete
		if (i === lines.length - 1 && !chunk.endsWith("\n") && line !== "") {
			remaining = line
			continue
		}

		// Empty line signals end of event
		if (line === "") {
			if (currentEvent && currentData.length > 0) {
				try {
					const dataStr = currentData.join("\n")
					const data = dataStr === "[DONE]" ? null : JSON.parse(dataStr)
					events.push({
						event: currentEvent as SSEEventType,
						data,
					})
				} catch {
					// Skip malformed events
					console.error("[claude-code-streaming] Failed to parse SSE data:", currentData.join("\n"))
				}
			}
			currentEvent = null
			currentData = []
			continue
		}

		// Parse event type
		if (line.startsWith("event: ")) {
			currentEvent = line.slice(7)
			continue
		}

		// Parse data
		if (line.startsWith("data: ")) {
			currentData.push(line.slice(6))
			continue
		}
	}

	// Return updated state for next chunk
	return {
		events,
		state: {
			buffer: remaining,
			currentEvent,
			currentData,
		},
	}
}

/**
 * Stream chunk types that the handler can yield
 */
export interface StreamTextChunk {
	type: "text"
	text: string
}

export interface StreamReasoningChunk {
	type: "reasoning"
	text: string
}

/**
 * A complete thinking block with signature, used for tool use continuations.
 * According to Anthropic docs:
 * - During tool use, you must pass thinking blocks back to the API for the last assistant message
 * - Include the complete unmodified block back to the API to maintain reasoning continuity
 * - The signature field is used to verify that thinking blocks were generated by Claude
 */
export interface StreamThinkingCompleteChunk {
	type: "thinking_complete"
	index: number
	thinking: string
	signature: string
}

export interface StreamToolCallPartialChunk {
	type: "tool_call_partial"
	index: number
	id?: string
	name?: string
	arguments?: string
}

export interface StreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	totalCost?: number
}

export interface StreamErrorChunk {
	type: "error"
	error: string
}

export type StreamChunk =
	| StreamTextChunk
	| StreamReasoningChunk
	| StreamThinkingCompleteChunk
	| StreamToolCallPartialChunk
	| StreamUsageChunk
	| StreamErrorChunk

/**
 * Creates a streaming message request to the Anthropic API using OAuth
 */
export async function* createStreamingMessage(options: StreamMessageOptions): AsyncGenerator<StreamChunk> {
	const { accessToken, model, systemPrompt, messages, maxTokens, thinking, tools, toolChoice, metadata, signal } =
		options

	// Filter out non-Anthropic blocks before processing
	const sanitizedMessages = filterNonAnthropicBlocks(messages)

	// Add cache breakpoints to the last two user messages
	// According to Anthropic docs:
	// - System prompts and tools remain cached despite thinking parameter changes
	// - Message cache breakpoints are invalidated when thinking parameters change
	// - We cache the last two user messages for optimal cache hit rates
	const messagesWithCache = addMessageCacheBreakpoints(sanitizedMessages)

	// Build request body - match Claude Code format exactly
	const body: Record<string, unknown> = {
		model,
		stream: true,
		messages: messagesWithCache,
	}

	// Only include max_tokens if explicitly provided
	if (maxTokens !== undefined) {
		body.max_tokens = maxTokens
	}

	// Add thinking configuration for extended thinking mode
	if (thinking) {
		body.thinking = thinking
	}

	// System prompt as array of content blocks (Claude Code format)
	// Prepend Claude Code branding as required by the API
	// Add cache_control to the last text block for prompt caching
	// System prompt caching is preserved even when thinking parameters change
	body.system = [
		{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
		...(systemPrompt ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] : []),
	]

	// Metadata with user_id is required for Claude Code
	if (metadata) {
		body.metadata = metadata
	}

	if (tools && tools.length > 0) {
		body.tools = tools
		// Default tool_choice to "auto" when tools are provided (as per spec example)
		body.tool_choice = toolChoice || { type: "auto" }
	} else if (toolChoice) {
		body.tool_choice = toolChoice
	}

	// Build minimal headers
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"Anthropic-Version": CLAUDE_CODE_API_CONFIG.version,
		"Anthropic-Beta": CLAUDE_CODE_API_CONFIG.defaultBetas.join(","),
		Accept: "text/event-stream",
		"User-Agent": CLAUDE_CODE_API_CONFIG.userAgent,
	}

	// Make the request
	const response = await fetch(`${CLAUDE_CODE_API_CONFIG.endpoint}?beta=true`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	})

	if (!response.ok) {
		const errorText = await response.text()
		let errorMessage = `API request failed: ${response.status} ${response.statusText}`
		try {
			const errorJson = JSON.parse(errorText)
			if (errorJson.error?.message) {
				errorMessage = errorJson.error.message
			}
		} catch {
			if (errorText) {
				errorMessage += ` - ${errorText}`
			}
		}
		yield { type: "error", error: errorMessage }
		return
	}

	if (!response.body) {
		yield { type: "error", error: "No response body" }
		return
	}

	// Track usage across events
	let totalInputTokens = 0
	let totalOutputTokens = 0
	let cacheReadTokens = 0
	let cacheWriteTokens = 0

	// Track content blocks by index for proper assembly
	// This is critical for interleaved thinking - we need to capture complete thinking blocks
	// with their signatures so they can be passed back to the API for tool use continuations
	const contentBlocks: Map<
		number,
		{
			type: string
			text: string
			signature?: string
			id?: string
			name?: string
			arguments?: string
		}
	> = new Map()

	// Read the stream
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let sseState = createSSEParserState()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			const chunk = decoder.decode(value, { stream: true })
			const result = parseSSEChunk(chunk, sseState)
			sseState = result.state
			const events = result.events

			for (const event of events) {
				const eventData = event.data as Record<string, unknown> | null

				if (!eventData) {
					continue
				}

				switch (event.event) {
					case "message_start": {
						const message = eventData.message as Record<string, unknown>
						if (!message) {
							break
						}
						const usage = message.usage as Record<string, number> | undefined
						if (usage) {
							totalInputTokens += usage.input_tokens || 0
							totalOutputTokens += usage.output_tokens || 0
							cacheReadTokens += usage.cache_read_input_tokens || 0
							cacheWriteTokens += usage.cache_creation_input_tokens || 0
						}
						break
					}

					case "content_block_start": {
						const contentBlock = eventData.content_block as Record<string, unknown>
						const index = eventData.index as number

						if (contentBlock) {
							switch (contentBlock.type) {
								case "text":
									// Initialize text block tracking
									contentBlocks.set(index, {
										type: "text",
										text: (contentBlock.text as string) || "",
									})
									if (contentBlock.text) {
										yield { type: "text", text: contentBlock.text as string }
									}
									break
								case "thinking":
									// Initialize thinking block tracking - critical for interleaved thinking
									// We need to accumulate the text and capture the signature
									contentBlocks.set(index, {
										type: "thinking",
										text: (contentBlock.thinking as string) || "",
									})
									if (contentBlock.thinking) {
										yield { type: "reasoning", text: contentBlock.thinking as string }
									}
									break
								case "tool_use":
									contentBlocks.set(index, {
										type: "tool_use",
										text: "",
										id: contentBlock.id as string,
										name: contentBlock.name as string,
										arguments: "",
									})
									yield {
										type: "tool_call_partial",
										index,
										id: contentBlock.id as string,
										name: contentBlock.name as string,
										arguments: undefined,
									}
									break
							}
						}
						break
					}

					case "content_block_delta": {
						const delta = eventData.delta as Record<string, unknown>
						const index = eventData.index as number
						const block = contentBlocks.get(index)

						if (delta) {
							switch (delta.type) {
								case "text_delta":
									if (delta.text) {
										// Accumulate text
										if (block && block.type === "text") {
											block.text += delta.text as string
										}
										yield { type: "text", text: delta.text as string }
									}
									break
								case "thinking_delta":
									if (delta.thinking) {
										// Accumulate thinking text
										if (block && block.type === "thinking") {
											block.text += delta.thinking as string
										}
										yield { type: "reasoning", text: delta.thinking as string }
									}
									break
								case "signature_delta":
									// Capture the signature for the thinking block
									// This is critical for interleaved thinking - the signature
									// must be included when passing thinking blocks back to the API
									if (delta.signature && block && block.type === "thinking") {
										block.signature = delta.signature as string
									}
									break
								case "input_json_delta":
									if (block && block.type === "tool_use") {
										block.arguments = (block.arguments || "") + (delta.partial_json as string)
									}
									yield {
										type: "tool_call_partial",
										index,
										id: undefined,
										name: undefined,
										arguments: delta.partial_json as string,
									}
									break
							}
						}
						break
					}

					case "content_block_stop": {
						// When a content block completes, emit complete thinking blocks
						// This enables the caller to preserve them for tool use continuations
						const index = eventData.index as number
						const block = contentBlocks.get(index)

						if (block && block.type === "thinking" && block.signature) {
							// Emit the complete thinking block with signature
							// This is required for interleaved thinking with tool use
							yield {
								type: "thinking_complete",
								index,
								thinking: block.text,
								signature: block.signature,
							}
						}
						break
					}

					case "message_delta": {
						const usage = eventData.usage as Record<string, number> | undefined
						if (usage && usage.output_tokens !== undefined) {
							// output_tokens in message_delta is the running total, not a delta
							// So we replace rather than add
							totalOutputTokens = usage.output_tokens
						}
						break
					}

					case "message_stop": {
						// Yield final usage chunk
						yield {
							type: "usage",
							inputTokens: totalInputTokens,
							outputTokens: totalOutputTokens,
							cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
							cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
						}
						break
					}

					case "error": {
						const errorData = eventData.error as Record<string, unknown>
						yield {
							type: "error",
							error: (errorData?.message as string) || "Unknown streaming error",
						}
						break
					}
				}
			}
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Parse rate limit headers from a response into a structured format
 */
function parseRateLimitHeaders(headers: Headers): ClaudeCodeRateLimitInfo {
	const getHeader = (name: string): string | null => headers.get(name)
	const parseFloat = (val: string | null): number => (val ? Number.parseFloat(val) : 0)
	const parseInt = (val: string | null): number => (val ? Number.parseInt(val, 10) : 0)

	return {
		fiveHour: {
			status: getHeader("anthropic-ratelimit-unified-5h-status") || "unknown",
			utilization: parseFloat(getHeader("anthropic-ratelimit-unified-5h-utilization")),
			resetTime: parseInt(getHeader("anthropic-ratelimit-unified-5h-reset")),
		},
		weekly: {
			status: getHeader("anthropic-ratelimit-unified-7d_sonnet-status") || "unknown",
			utilization: parseFloat(getHeader("anthropic-ratelimit-unified-7d_sonnet-utilization")),
			resetTime: parseInt(getHeader("anthropic-ratelimit-unified-7d_sonnet-reset")),
		},
		weeklyUnified: {
			status: getHeader("anthropic-ratelimit-unified-7d-status") || "unknown",
			utilization: parseFloat(getHeader("anthropic-ratelimit-unified-7d-utilization")),
			resetTime: parseInt(getHeader("anthropic-ratelimit-unified-7d-reset")),
		},
		representativeClaim: getHeader("anthropic-ratelimit-unified-representative-claim") || undefined,
		overage: {
			status: getHeader("anthropic-ratelimit-unified-overage-status") || "unknown",
			disabledReason: getHeader("anthropic-ratelimit-unified-overage-disabled-reason") || undefined,
		},
		fallbackPercentage: parseFloat(getHeader("anthropic-ratelimit-unified-fallback-percentage")) || undefined,
		organizationId: getHeader("anthropic-organization-id") || undefined,
		fetchedAt: Date.now(),
	}
}

/**
 * Fetch rate limit information by making a minimal API call
 * Uses a small request to get the response headers containing rate limit data
 */
export async function fetchRateLimitInfo(accessToken: string): Promise<ClaudeCodeRateLimitInfo> {
	// Build minimal request body - use haiku for speed and lowest cost
	const body = {
		model: "claude-haiku-4-5",
		max_tokens: 1,
		system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
		messages: [{ role: "user", content: "hi" }],
	}

	// Build minimal headers
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"Anthropic-Version": CLAUDE_CODE_API_CONFIG.version,
		"Anthropic-Beta": CLAUDE_CODE_API_CONFIG.defaultBetas.join(","),
		"User-Agent": CLAUDE_CODE_API_CONFIG.userAgent,
	}

	// Make the request
	const response = await fetch(`${CLAUDE_CODE_API_CONFIG.endpoint}?beta=true`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30000),
	})

	if (!response.ok) {
		const errorText = await response.text()
		let errorMessage = `API request failed: ${response.status} ${response.statusText}`
		try {
			const errorJson = JSON.parse(errorText)
			if (errorJson.error?.message) {
				errorMessage = errorJson.error.message
			}
		} catch {
			if (errorText) {
				errorMessage += ` - ${errorText}`
			}
		}
		throw new Error(errorMessage)
	}

	// Parse rate limit headers from the response
	return parseRateLimitHeaders(response.headers)
}
