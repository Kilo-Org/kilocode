import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { executeCommand } from "./executeCommandTool"

export async function gitCommitTool(
	task: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const commitMessage: string | undefined = block.params.commit_message

	try {
		if (block.partial) {
			const toolMessage = JSON.stringify({
				tool: block.name,
				commit_message: removeClosingTag("commit_message", commitMessage),
			})
			await task.ask("tool", toolMessage, block.partial).catch(() => {})
			return
		} else {
			if (!commitMessage) {
				task.consecutiveMistakeCount++
				task.recordToolError("git_commit")
				pushToolResult(await task.sayAndCreateMissingParamError("git_commit", "commit_message"))
				return
			}

			task.consecutiveMistakeCount = 0

			// First add all changes
			const addCommand = "git add ."
			const addDidApprove = await askApproval("command", addCommand)

			if (!addDidApprove) {
				return
			}

			const [addRejected, addResult] = await executeCommand(task, {
				executionId: task.lastMessageTs?.toString() ?? Date.now().toString(),
				command: addCommand,
			})

			if (addRejected) {
				task.didRejectTool = true
				pushToolResult(addResult)
				return
			}

			// Then commit
			const commitCommand = `git commit -m "${commitMessage}"`
			const commitDidApprove = await askApproval("command", commitCommand)

			if (!commitDidApprove) {
				return
			}

			const [commitRejected, commitResult] = await executeCommand(task, {
				executionId: task.lastMessageTs?.toString() ?? Date.now().toString(),
				command: commitCommand,
			})

			if (commitRejected) {
				task.didRejectTool = true
			}

			pushToolResult(commitResult)
			return
		}
	} catch (error) {
		await handleError("committing changes", error)
		return
	}
}
