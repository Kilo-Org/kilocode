import * as vscode from "vscode"

import { RooCodeEventName, type HistoryItem, type SuggestionItem } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"
import { getCommitRangeForNewCompletion } from "../checkpoints/kilocode/seeNewChanges" // kilocode_change

// kilocode_change start
async function getClineMessageOptions(
	task: Task,
): Promise<{ isNonInteractive?: boolean; metadata?: Record<string, unknown> }> {
	const commitRange = await getCommitRangeForNewCompletion(task)

	if (!commitRange) {
		return {}
	}

	return {
		metadata: {
			kiloCode: { commitRange },
		},
	}
}
// kilocode_change end

// kilocode_change start - Generate post-completion suggestions based on task mode
export function getCompletionSuggestions(task: Task): SuggestionItem[] | undefined {
	const mode = task.taskMode
	if (mode === "code" || mode === "orchestrator") {
		return [{ answer: t("common:suggestions.start_code_review"), mode: "review" }]
	}
	return undefined
}
// kilocode_change end

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	parseLegacy(params: Partial<Record<string, string>>): AttemptCompletionParams {
		return {
			result: params.result || "",
			command: params.command,
		}
	}

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			await task.say(
				"completion_result",
				result,
				undefined,
				false,
				// kilocode_change start
				undefined,
				undefined,
				await getClineMessageOptions(task),
				// kilocode_change end
			)

			// Force final token usage update before emitting TaskCompleted
			// This ensures the most recent stats are captured regardless of throttle timer
			// and properly updates the snapshot to prevent redundant emissions
			task.emitFinalTokenUsageUpdate()

			TelemetryService.instance.captureTaskCompleted(task.taskId)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegated = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegated) return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			// kilocode_change start - Pass completion suggestions based on task mode
			const completionSuggestions = getCompletionSuggestions(task)
			const completionAskText = completionSuggestions ? JSON.stringify({ suggest: completionSuggestions }) : ""
			// kilocode_change end

			const { response, text, images } = await task.ask("completion_result", completionAskText, false)

			if (response === "yesButtonClicked") {
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns true if delegation was performed and the caller should return early.
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<boolean> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return true
		}

		pushToolResult("")

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		return true
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task
					.ask("command", this.removeClosingTag("command", command, block.partial), block.partial)
					.catch(() => {})
			} else {
				await task.say(
					"completion_result",
					this.removeClosingTag("result", result, block.partial),
					undefined,
					false,
					// kilocode_change start
					undefined,
					undefined,
					await getClineMessageOptions(task),
					// kilocode_change end
				)

				// Force final token usage update before emitting TaskCompleted for consistency
				task.emitFinalTokenUsageUpdate()

				TelemetryService.instance.captureTaskCompleted(task.taskId)
				task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)

				await task
					.ask("command", this.removeClosingTag("command", command, block.partial), block.partial)
					.catch(() => {})
			}
		} else {
			await task.say(
				"completion_result",
				this.removeClosingTag("result", result, block.partial),
				undefined,
				block.partial,
				// kilocode_change start
				undefined,
				undefined,
				await getClineMessageOptions(task),
				// kilocode_change end
			)
		}
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
