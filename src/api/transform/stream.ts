export type ApiStream = AsyncGenerator<ApiStreamChunk>

export type ApiStreamChunk =
	// kilocode_change start
	| ApiStreamAnthropicThinkingChunk
	| ApiStreamAnthropicRedactedThinkingChunk
	// kilocode_change end
	| ApiStreamTextChunk
	| ApiStreamUsageChunk
	| ApiStreamReasoningChunk
	| ApiStreamGroundingChunk
	| ApiStreamToolCallChunk
	| ApiStreamToolCallStartChunk
	| ApiStreamToolCallDeltaChunk
	| ApiStreamToolCallEndChunk
	| ApiStreamToolCallPartialChunk
	| ApiStreamError

export interface ApiStreamError {
	type: "error"
	error: string
	message: string
}

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	text: string
}

// kilocode_change start
export interface ApiStreamAnthropicThinkingChunk {
	type: "ant_thinking"
	thinking: string
	signature: string
}

export interface ApiStreamAnthropicRedactedThinkingChunk {
	type: "ant_redacted_thinking"
	data: string
}
// kilocode_change end

export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	reasoningTokens?: number
	totalCost?: number
	inferenceProvider?: string // kilocode_change
}

export interface ApiStreamGroundingChunk {
	type: "grounding"
	sources: GroundingSource[]
}

export interface ApiStreamToolCallChunk {
	type: "tool_call"
	id: string
	name: string
	arguments: string
}

export interface ApiStreamToolCallStartChunk {
	type: "tool_call_start"
	id: string
	name: string
}

export interface ApiStreamToolCallDeltaChunk {
	type: "tool_call_delta"
	id: string
	delta: string
}

export interface ApiStreamToolCallEndChunk {
	type: "tool_call_end"
	id: string
}

/**
 * Raw tool call chunk from the API stream.
 * Providers emit this simple format; NativeToolCallParser handles all state management
 * (tracking, buffering, emitting start/delta/end events).
 */
export interface ApiStreamToolCallPartialChunk {
	type: "tool_call_partial"
	index: number
	id?: string
	name?: string
	arguments?: string
}

export interface GroundingSource {
	title: string
	url: string
	snippet?: string
}
