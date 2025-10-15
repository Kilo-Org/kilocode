import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { executeCommand } from "./executeCommandTool"

export async function gitPushTool(
	task: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		if (block.partial) {
			const toolMessage = JSON.stringify({
				tool: block.name,
			})
			await task.ask("tool", toolMessage, block.partial).catch(() => {})
			return
		} else {
			task.consecutiveMistakeCount = 0

			const command = "git push"
			const didApprove = await askApproval("command", command)

			if (!didApprove) {
				return
			}

			const [rejected, result] = await executeCommand(task, {
				executionId: task.lastMessageTs?.toString() ?? Date.now().toString(),
				command,
			})

			if (rejected) {
				task.didRejectTool = true
			}

			pushToolResult(result)
			return
		}
	} catch (error) {
		await handleError("pushing changes", error)
		return
	}
}
