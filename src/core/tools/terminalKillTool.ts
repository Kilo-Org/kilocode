// kilocode_change - new file: Terminal control tool for managing background processes
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"

export async function terminalKillTool(
	task: Task,
	block: ToolUse,
	_askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	_removeClosingTag: RemoveClosingTag,
) {
	const terminalId: string | undefined = block.params.terminal_id
	if (!terminalId) {
		task.consecutiveMistakeCount++
		task.recordToolError("terminal_kill")
		pushToolResult(await task.sayAndCreateMissingParamError("terminal_kill", "terminal_id"))
		return
	}

	await task.say("text", `Killing process in terminal ${terminalId}...`)

	try {
		const result = await TerminalRegistry.killTerminal(parseInt(terminalId))
		pushToolResult(formatResponse.toolResult(result))
	} catch (error) {
		await handleError("killing terminal process", error)
	}
}
