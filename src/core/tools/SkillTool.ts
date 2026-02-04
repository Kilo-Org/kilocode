import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface SkillParams {
	skill: string
	args?: string | null
}

export class SkillTool extends BaseTool<"skill"> {
	readonly name = "skill" as const

	async execute(params: SkillParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { skill: skillName, args } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate skill name parameter
			if (!skillName) {
				task.consecutiveMistakeCount++
				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("skill", "skill"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Get SkillsManager from provider
			const provider = task.providerRef.deref()
			const skillsManager = provider?.getSkillsManager()

			if (!skillsManager) {
				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Skills Manager not available"))
				return
			}

			// Get current mode for skill resolution
			const state = await provider?.getState()
			const currentMode = state?.mode ?? "code"

			// Fetch skill content
			const skillContent = await skillsManager.getSkillContent(skillName, currentMode)

			if (!skillContent) {
				// Get available skills for error message
				const availableSkills = skillsManager.getSkillsForMode(currentMode)
				const skillNames = availableSkills.map((s) => s.name)

				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Skill '${skillName}' not found. Available skills: ${skillNames.join(", ") || "(none)"}`,
					),
				)
				return
			}

			// Build approval message
			const toolMessage = JSON.stringify({
				tool: "skill",
				skill: skillName,
				args: args,
				source: skillContent.source,
				description: skillContent.description,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Build the result message
			let result = `Skill: ${skillName}`

			if (skillContent.description) {
				result += `\nDescription: ${skillContent.description}`
			}

			if (args) {
				result += `\nProvided arguments: ${args}`
			}

			result += `\nSource: ${skillContent.source}`
			result += `\n\n--- Skill Instructions ---\n\n${skillContent.instructions}`

			pushToolResult(result)
		} catch (error) {
			await handleError("executing skill", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"skill">): Promise<void> {
		const skillName: string | undefined = block.params.skill
		const args: string | undefined = block.params.args

		const partialMessage = JSON.stringify({
			tool: "skill",
			skill: skillName,
			args: args,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const skillTool = new SkillTool()
