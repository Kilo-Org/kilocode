/**
 * Shared constants and types for the subagent feature.
 * Used by SubagentTool, Task, build-tools, and UI to stay in sync with tool message shapes.
 */

/** Tool names used in say("tool", ...) payloads for subagent progress and completion. */
export const SUBAGENT_TOOL_NAMES = {
	running: "subagentRunning",
	completed: "subagentCompleted",
} as const

/** i18n keys sent as currentTask; webview uses t(key) to show locale. */
export const SUBAGENT_STATUS_STARTING = "chat:subagents.starting"
export const SUBAGENT_STATUS_THINKING = "chat:subagents.thinking"

/** Structured result codes for subagent completion; webview uses messageKey with t() for display. */
export const SUBAGENT_RESULT_CODE_CANCELLED = "CANCELLED" as const
export const SUBAGENT_CANCELLED_MESSAGE_KEY = "chat:subagents.cancelledByUser" as const

/** Sent when the user cancels the subagent. Extension passes this to backgroundCompletionResolve. */
export const SUBAGENT_CANCELLED_STRUCTURED_RESULT = {
	code: SUBAGENT_RESULT_CODE_CANCELLED,
	messageKey: SUBAGENT_CANCELLED_MESSAGE_KEY,
} as const

/** English message shown to the model when subagent is cancelled (tool result). */
export const SUBAGENT_CANCELLED_MODEL_MESSAGE = "Subagent was cancelled by the user."

/** Generic message shown to the model/UI when subagent fails (avoids leaking internal error details). */
export const SUBAGENT_FAILED_MODEL_MESSAGE = "The subagent failed."

export type SubagentStructuredResult = typeof SUBAGENT_CANCELLED_STRUCTURED_RESULT

/** Payload for the "subagentRunning" tool message (progress updates). */
export interface SubagentRunningPayload {
	tool: typeof SUBAGENT_TOOL_NAMES.running
	description?: string
	currentTask?: string
}

/** Payload for the "subagentCompleted" tool message (result or error). */
export interface SubagentCompletedPayload {
	tool: typeof SUBAGENT_TOOL_NAMES.completed
	description?: string
	result?: string
	error?: string
	/** When set, webview shows t(messageKey) instead of result/error. */
	resultCode?: string
	messageKey?: string
}

export type SubagentType = "general" | "explore"

/** Parameters for running a subagent in the background. */
export interface RunSubagentInBackgroundParams {
	parentTaskId: string
	prompt: string
	subagentType: SubagentType
	onProgress?: (currentTask: string) => void
}

/** Provider interface for running a subagent. Allows SubagentTool to call without type assertion. */
export interface SubagentRunner {
	runSubagentInBackground(params: RunSubagentInBackgroundParams): Promise<string | SubagentStructuredResult>
}

export function isSubagentRunner(provider: unknown): provider is SubagentRunner {
	return (
		typeof provider === "object" &&
		provider !== null &&
		"runSubagentInBackground" in provider &&
		typeof (provider as SubagentRunner).runSubagentInBackground === "function"
	)
}
