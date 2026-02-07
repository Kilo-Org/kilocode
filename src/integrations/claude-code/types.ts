import type { Anthropic } from "@anthropic-ai/sdk"

export type InitMessage = {
	type: "system"
	subtype: "init"
	session_id: string
	tools: string[]
	mcp_servers: string[]
	apiKeySource: "none" | "/login managed key" | string
}

export type AssistantMessage = {
	type: "assistant"
	message: Anthropic.Messages.Message
	session_id: string
}

export type ErrorMessage = {
	type: "error"
}

export type ResultMessage = {
	type: "result"
	subtype: "success"
	total_cost_usd: number
	is_error: boolean
	duration_ms: number
	duration_api_ms: number
	num_turns: number
	result: string
	session_id: string
}

export type ClaudeCodeMessage = InitMessage | AssistantMessage | ErrorMessage | ResultMessage
