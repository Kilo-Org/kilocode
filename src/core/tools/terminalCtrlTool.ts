import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"

export async function terminalCtrlTool(
	task: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const action: string | undefined = block.params.action
	const terminalId: string | undefined = block.params.terminal_id

	try {
		if (block.partial) {
			await task.ask("command", removeClosingTag("action", action), block.partial).catch(() => {})
			return
		}

		if (!action) {
			task.consecutiveMistakeCount++
			task.recordToolError("terminal_ctrl")
			pushToolResult(await task.sayAndCreateMissingParamError("terminal_ctrl", "action"))
			return
		}

		if (!terminalId) {
			task.consecutiveMistakeCount++
			task.recordToolError("terminal_ctrl")
			pushToolResult(await task.sayAndCreateMissingParamError("terminal_ctrl", "terminal_id"))
			return
		}

		// Only support kill action for MVP
		if (action !== "kill") {
			task.consecutiveMistakeCount++
			task.recordToolError("terminal_ctrl")
			pushToolResult(formatResponse.toolError(`Invalid action "${action}". Only "kill" is supported.`))
			return
		}

		// Get approval for the action
		const didApprove = await askApproval("command", `Kill process in terminal ${terminalId}`)
		if (!didApprove) {
			return
		}

		try {
			const result = await killTerminalProcess(parseInt(terminalId))
			pushToolResult(formatResponse.toolResult(result))
		} catch (error) {
			await handleError("killing terminal process", error)
		}
	} catch (error) {
		await handleError("terminal control operation", error)
	}
}

/**
 * Kills a process running in a specific terminal by sending Ctrl+C
 * @param terminalId The terminal ID containing the process to kill
 * @returns Promise<string> Result message
 */
async function killTerminalProcess(terminalId: number): Promise<string> {
	const targetTerminal = findTerminal(terminalId)
	if (!targetTerminal) {
		return getTerminalNotFoundMessage(terminalId)
	}

	if (!targetTerminal.busy && !targetTerminal.process) {
		return `Terminal ${terminalId} is not running any process.`
	}

	try {
		if (targetTerminal instanceof Terminal) {
			// For VSCode terminals, send Ctrl+C
			targetTerminal.terminal.sendText("\x03")
			return `Sent Ctrl+C to terminal ${terminalId}. Process should terminate shortly.`
		} else {
			// For ExecaTerminal, use the abort method
			if (targetTerminal.process) {
				targetTerminal.process.abort()
				return `Terminated process in terminal ${terminalId}.`
			} else {
				return `No active process found in terminal ${terminalId}.`
			}
		}
	} catch (error) {
		throw new Error(
			`Failed to kill process in terminal ${terminalId}: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Helper function to find a terminal by ID
 */
function findTerminal(terminalId: number) {
	const busyTerminals = TerminalRegistry.getTerminals(true)
	const allTerminals = TerminalRegistry.getTerminals(false)
	const allTerminalsList = [...busyTerminals, ...allTerminals]

	return allTerminalsList.find((t) => t.id === terminalId)
}

/**
 * Helper function to get terminal not found message
 */
function getTerminalNotFoundMessage(terminalId: number): string {
	const busyTerminals = TerminalRegistry.getTerminals(true)
	const allTerminals = TerminalRegistry.getTerminals(false)
	const allTerminalsList = [...busyTerminals, ...allTerminals]

	return `Terminal ${terminalId} not found. Available terminals: ${allTerminalsList.map((t) => t.id).join(", ")}`
}
