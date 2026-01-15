import { logs } from "../services/logs.js"
import type { CLI } from "../cli.js"
import { getTelemetryService } from "../services/telemetry/index.js"

export const onTaskCompletedTimeout = 90000 // 90 seconds for task completion

/**
 * Validate the on-task-completed prompt string.
 * Returns an object with valid flag and optional error message.
 *
 * Validation rules:
 * - Must not be empty or whitespace-only
 * - Must not exceed 50,000 characters (reasonable limit for prompts)
 * - Handles special characters, markdown, and newlines (all allowed)
 */
export function validateOnTaskCompletedPrompt(prompt: string): { valid: boolean; error?: string } {
	// Check for empty or whitespace-only
	if (!prompt || prompt.trim().length === 0) {
		return { valid: false, error: "--on-task-completed prompt cannot be empty" }
	}

	// Check for maximum length (50KB is a reasonable limit)
	const maxLength = 50000
	if (prompt.length > maxLength) {
		return {
			valid: false,
			error: `--on-task-completed prompt exceeds maximum length of ${maxLength} characters (got ${prompt.length})`,
		}
	}

	return { valid: true }
}

export interface FinishWithOnTaskCompletedInput {
	cwd: string
	prompt: string
}

/**
 * Finish task by sending a custom prompt to the agent
 * This function should be called from the CLI dispose method when --on-task-completed is enabled
 * Since it's part of the dispose flow, this function must never throw an error
 */
export async function finishWithOnTaskCompleted(cli: CLI, input: FinishWithOnTaskCompletedInput): Promise<() => void> {
	const { prompt } = input
	const beforeExit = () => {}

	try {
		const service = cli.getService()
		if (!service) {
			logs.error("Extension service not available for on-task-completed", "OnTaskCompleted")
			return beforeExit
		}

		logs.info("Sending on-task-completed prompt to agent...", "OnTaskCompleted")
		logs.debug(`Prompt: ${prompt.substring(0, 100)}...`, "OnTaskCompleted")

		await service.sendWebviewMessage({
			type: "askResponse",
			askResponse: "messageResponse",
			text: prompt,
		})

		logs.info("Waiting for agent to complete on-task-completed prompt...", "OnTaskCompleted")

		// Wait for the agent to process the prompt
		// The agent will complete when it calls attempt_completion again
		await new Promise((resolve) => setTimeout(resolve, onTaskCompletedTimeout))

		logs.info("On-task-completed flow completed", "OnTaskCompleted")

		// Track telemetry
		getTelemetryService().trackFeatureUsed("on_task_completed", 1, true)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logs.error("Failed during on-task-completed flow", "OnTaskCompleted", { error: errorMessage })

		// Track error telemetry
		getTelemetryService().trackError("on_task_completed_error", errorMessage)
	}

	return beforeExit
}
