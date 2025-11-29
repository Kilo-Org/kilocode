// kilocode_change - new file: Terminal control tool for managing background processes
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { blob } from "node:stream/consumers"

interface TerminalKillParams {
	terminal_id: number
}

export class TerminalKillTool extends BaseTool<"terminal_kill"> {
	readonly name = "terminal_kill" as const

	parseLegacy(params: Partial<Record<string, string>>): TerminalKillParams {
		const terminalIdParam = params.terminal_id
		const terminalId: number | undefined = terminalIdParam ? parseInt(terminalIdParam, 10) : undefined

		return {
			terminal_id: terminalId ?? NaN,
		}
	}

	async execute(params: TerminalKillParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { terminal_id: terminalId } = params
		const { handleError, pushToolResult } = callbacks

		if (terminalId === undefined || isNaN(terminalId)) {
			task.consecutiveMistakeCount++
			task.recordToolError("terminal_kill")
			pushToolResult(await task.sayAndCreateMissingParamError("terminal_kill", "terminal_id"))
			return
		}

		task.consecutiveMistakeCount = 0

		// Verify terminal exists
		const terminal = TerminalRegistry.findTerminal(terminalId)
		if (!terminal) {
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
			await handleError("killing terminal process", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"terminal_kill">): Promise<void> {
		return
	}
}

export const terminalKillTool = new TerminalKillTool()
