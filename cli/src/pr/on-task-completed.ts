import { logs } from "../services/logs.js"
import type { CLI } from "../cli.js"
import { getTelemetryService } from "../services/telemetry/index.js"

export const onTaskCompletedTimeout = 90000 // 90 seconds for task completion

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
	let beforeExit = () => {}

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

		beforeExit = () => {
			const green = "\x1b[32m"
			const cyan = "\x1b[36m"
			const reset = "\x1b[0m"

			console.log("\n" + cyan + "─".repeat(80) + reset)
			console.log(`${green}✓${reset} On-task-completed prompt executed!`)
			console.log(cyan + "─".repeat(80) + reset + "\n")
		}

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
