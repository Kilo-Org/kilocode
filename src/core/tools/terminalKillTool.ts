// kilocode_change - new file: Terminal control tool for managing background processes
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
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
	const terminalIdParam = block.params.terminal_id
	const terminalId: number | undefined =
		typeof terminalIdParam === "number"
			? terminalIdParam
			: terminalIdParam
				? parseInt(terminalIdParam, 10)
				: undefined

	if (terminalId === undefined || isNaN(terminalId)) {
		task.consecutiveMistakeCount++
		task.recordToolError("terminal_kill")
		pushToolResult(await task.sayAndCreateMissingParamError("terminal_kill", "terminal_id"))
		return
	}

	// Verify terminal exists
	const terminal = TerminalRegistry.findTerminal(terminalId)
	if (!terminal) {
		task.consecutiveMistakeCount++
		task.recordToolError("terminal_kill")
		pushToolResult(formatResponse.toolError(`Terminal ${terminalId} not found.`))
		return
	}

	// Verify terminal is actually running a process
	if (!terminal.busy && !terminal.process) {
		pushToolResult(formatResponse.toolResult(`Terminal ${terminalId} is not running any process.`))
		return
	}
	await task.say("text", `Killing process in terminal ${terminalId}...`)

	try {
		const result = await TerminalRegistry.killTerminal(terminalId)
		pushToolResult(formatResponse.toolResult(result))
	} catch (error) {
		await handleError("killing terminal process", error)
	}
}
