/**
 * Shared constants and types for the subagent feature.
 * Used by SubagentTool, Task, build-tools, and UI to stay in sync with tool message shapes.
 */

/** Tool names used in say("tool", ...) payloads for subagent progress and completion. */
export const SUBAGENT_TOOL_NAMES = {
	running: "subagentRunning",
	completed: "subagentCompleted",
} as const

/** Message returned as subagent result when the user cancels the subagent. */
export const SUBAGENT_CANCELLED_MESSAGE = "Subagent was cancelled by the user."

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
	runSubagentInBackground(params: RunSubagentInBackgroundParams): Promise<string>
}

export function isSubagentRunner(provider: unknown): provider is SubagentRunner {
	return (
		typeof provider === "object" &&
		provider !== null &&
		"runSubagentInBackground" in provider &&
		typeof (provider as SubagentRunner).runSubagentInBackground === "function"
	)
}
