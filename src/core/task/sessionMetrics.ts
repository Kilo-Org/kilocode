// kilocode_change - new file

import type { ClineMessage, TokenUsage, ToolName, ToolUsage } from "@roo-code/types"
import type { ClineApiReqCancelReason } from "../../shared/ExtensionMessage"

export type SessionTerminationReason = "user_closed" | "timeout" | "explicit_completion" | "error"

export type SessionToolCallsByType = Record<string, number>
export type SessionErrorsByType = Record<string, number>

export interface SessionMetrics {
	sessionDurationMs: number
	totalTurns: number
	toolCallsByType: SessionToolCallsByType
	errorsByType: SessionErrorsByType
	totalTokensConsumed: number
	totalTokensIn: number
	totalTokensOut: number
	terminationReason: SessionTerminationReason
}

export interface ComputeSessionMetricsInput {
	startedAtMs: number
	endedAtMs: number
	clineMessages: ClineMessage[]
	toolUsage: ToolUsage
	tokenUsage: TokenUsage
	abortReason?: ClineApiReqCancelReason
	terminationReason: SessionTerminationReason
}

function getTotalTurnsFromMessages(messages: ClineMessage[]): number {
	return messages.filter((m) => m.type === "say" && m.say === "api_req_started").length
}

function getToolCallsByType(toolUsage: ToolUsage): SessionToolCallsByType {
	const result: SessionToolCallsByType = {}

	for (const [tool, stats] of Object.entries(toolUsage) as Array<[ToolName, ToolUsage[ToolName]]>) {
		if (!stats) continue
		if (typeof stats.attempts === "number" && stats.attempts > 0) {
			result[tool] = stats.attempts
		}
	}

	return result
}

function getErrorsByType(toolUsage: ToolUsage, abortReason?: ClineApiReqCancelReason): SessionErrorsByType {
	const result: SessionErrorsByType = {}

	for (const [tool, stats] of Object.entries(toolUsage) as Array<[ToolName, ToolUsage[ToolName]]>) {
		if (!stats) continue
		if (typeof stats.failures === "number" && stats.failures > 0) {
			result[`tool:${tool}`] = stats.failures
		}
	}

	// Capture a single top-level API/stream failure reason for session-level rollups.
	if (abortReason === "streaming_failed") {
		result["api:streaming_failed"] = (result["api:streaming_failed"] ?? 0) + 1
	}

	return result
}

export function computeSessionMetrics(input: ComputeSessionMetricsInput): SessionMetrics {
	const durationMs = Math.max(0, input.endedAtMs - input.startedAtMs)

	const totalTokensIn = input.tokenUsage.totalTokensIn ?? 0
	const totalTokensOut = input.tokenUsage.totalTokensOut ?? 0

	return {
		sessionDurationMs: durationMs,
		totalTurns: getTotalTurnsFromMessages(input.clineMessages),
		toolCallsByType: getToolCallsByType(input.toolUsage),
		errorsByType: getErrorsByType(input.toolUsage, input.abortReason),
		totalTokensConsumed: totalTokensIn + totalTokensOut,
		totalTokensIn,
		totalTokensOut,
		terminationReason: input.terminationReason,
	}
}
