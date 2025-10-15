import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { executeCommand } from "./executeCommandTool"

export async function gitBranchTool(
	task: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const branchName: string | undefined = block.params.branch_name

	try {
		if (block.partial) {
			const toolMessage = JSON.stringify({
				tool: block.name,
				branch_name: removeClosingTag("branch_name", branchName),
			})
			await task.ask("tool", toolMessage, block.partial).catch(() => {})
			return
		} else {
			if (!branchName) {
				task.consecutiveMistakeCount++
				task.recordToolError("git_branch")
				pushToolResult(await task.sayAndCreateMissingParamError("git_branch", "branch_name"))
				return
			}

			task.consecutiveMistakeCount = 0

			const command = `git checkout -b ${branchName}`
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
		await handleError("creating git branch", error)
		return
	}
}
