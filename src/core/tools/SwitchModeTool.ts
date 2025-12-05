import delay from "delay"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface SwitchModeParams {
	mode_slug: string
	reason: string
}

export class SwitchModeTool extends BaseTool<"switch_mode"> {
	readonly name = "switch_mode" as const

	parseLegacy(params: Partial<Record<string, string>>): SwitchModeParams {
		return {
			mode_slug: params.mode_slug || "",
			reason: params.reason || "",
		}
	}

	async execute(params: SwitchModeParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { mode_slug, reason } = params
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		try {
			if (!mode_slug) {
				task.consecutiveMistakeCount++
				task.recordToolError("switch_mode")
				pushToolResult(await task.sayAndCreateMissingParamError("switch_mode", "mode_slug"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Verify the mode exists
			const targetMode = getModeBySlug(mode_slug, (await task.providerRef.deref()?.getState())?.customModes)

			if (!targetMode) {
				task.recordToolError("switch_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
				return
			}

			// Check if already in requested mode
			const currentMode = (await task.providerRef.deref()?.getState())?.mode ?? defaultModeSlug

			if (currentMode === mode_slug) {
				task.recordToolError("switch_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(`Already in ${targetMode.name} mode.`)
				return
			}

			const completeMessage = JSON.stringify({ tool: "switchMode", mode: mode_slug, reason })
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			// Switch the mode using shared handler
			await task.providerRef.deref()?.handleModeSwitch(mode_slug)

			pushToolResult(
				`Successfully switched from ${getModeBySlug(currentMode)?.name ?? currentMode} mode to ${
					targetMode.name
				} mode${reason ? ` because: ${reason}` : ""}.`,
			)

			await delay(500) // Delay to allow mode change to take effect before next tool is executed
		} catch (error) {
			await handleError("switching mode", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"switch_mode">): Promise<void> {
		const mode_slug: string | undefined = block.params.mode_slug
		const reason: string | undefined = block.params.reason

		const partialMessage = JSON.stringify({
			tool: "switchMode",
			mode: this.removeClosingTag("mode_slug", mode_slug, block.partial),
			reason: this.removeClosingTag("reason", reason, block.partial),
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const switchModeTool = new SwitchModeTool()
