// kilocode_change - new file

import path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { regexSearchFiles } from "../../services/ripgrep"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface FindReferencesParams {
	symbol: string
	path?: string | null
}

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export class FindReferencesTool extends BaseTool<"find_references"> {
	readonly name = "find_references" as const

	parseLegacy(params: Partial<Record<string, string>>): FindReferencesParams {
		return {
			symbol: params.symbol || "",
			path: params.path || undefined,
		}
	}

	async execute(params: FindReferencesParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const symbol = params.symbol
		const relDirPath = params.path && params.path.trim() !== "" ? params.path : "."

		if (!symbol) {
			task.consecutiveMistakeCount++
			task.recordToolError("find_references")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("find_references", "symbol"))
			return
		}

		task.consecutiveMistakeCount = 0

		const absolutePath = path.resolve(task.cwd, relDirPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const regex = `\\b${escapeRegexLiteral(symbol)}\\b`
		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, relDirPath),
			regex,
			filePattern: undefined,
			isOutsideWorkspace,
		}

		try {
			const results = await regexSearchFiles(task.cwd, absolutePath, regex, undefined, task.rooIgnoreController)
			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: results } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)
			if (!didApprove) {
				return
			}
			pushToolResult(results)
		} catch (error) {
			await handleError("finding references", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"find_references">): Promise<void> {
		const symbol = block.params.symbol
		const relDirPath = block.params.path

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const regex = `\\b${escapeRegexLiteral(this.removeClosingTag("symbol", symbol, block.partial))}\\b`
		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, this.removeClosingTag("path", relDirPath, block.partial)),
			regex,
			filePattern: undefined,
			isOutsideWorkspace,
		}

		await task
			.ask("tool", JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool), block.partial)
			.catch(() => {})
	}
}

export const findReferencesTool = new FindReferencesTool()
