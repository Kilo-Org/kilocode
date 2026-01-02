// kilocode_change - new file

import * as vscode from "vscode"
import path from "path"

import { Task } from "../task/Task"
import { CodeIndexManager } from "../../services/code-index/manager"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getWorkspacePath } from "../../utils/path"

interface SemanticSearchParams {
	query: string
	path?: string
}

export class SemanticSearchTool extends BaseTool<"semantic_search"> {
	readonly name = "semantic_search" as const

	parseLegacy(params: Partial<Record<string, string>>): SemanticSearchParams {
		let query = params.query
		let directoryPrefix = params.path

		if (directoryPrefix) {
			directoryPrefix = path.normalize(directoryPrefix)
		}

		return {
			query: query || "",
			path: directoryPrefix || undefined,
		}
	}

	async execute(params: SemanticSearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		let { query, path: directoryPrefix } = params

		if (!query) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("semantic_search", "query"))
			return
		}

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query,
			path: directoryPrefix,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied(toolProtocol))
			return
		}

		try {
			const provider = task.providerRef.deref()
			if (!provider) {
				await handleError("semantic_search", new Error("No provider available"))
				return
			}

			const workspacePath = task.cwd && task.cwd.trim() !== "" ? task.cwd : getWorkspacePath()
			if (!workspacePath) {
				await handleError("semantic_search", new Error("Could not determine workspace path."))
				return
			}

			const manager = CodeIndexManager.getInstance(provider.context, workspacePath)
			if (!manager) {
				pushToolResult(
					formatResponse.toolError("Code index manager is unavailable for this workspace.", toolProtocol),
				)
				return
			}

			const status = manager.getCurrentStatus()
			if (status.systemStatus !== "Indexed" && status.systemStatus !== "Indexing") {
				pushToolResult(
					formatResponse.toolError(
						`Code index is not ready. Current status: ${status.systemStatus}`,
						toolProtocol,
					),
				)
				return
			}

			const results = await manager.searchIndex(query, directoryPrefix)
			if (!results.length) {
				pushToolResult(`No relevant code snippets found for the query: "${query}"`)
				return
			}

			const jsonResult = {
				query,
				results: results
					.filter((r) => r.payload && "filePath" in r.payload)
					.map((r) => ({
						filePath: vscode.workspace.asRelativePath((r.payload as any).filePath, false),
						score: r.score,
						startLine: (r.payload as any).startLine,
						endLine: (r.payload as any).endLine,
						codeChunk: ((r.payload as any).codeChunk || "").trim(),
					})),
			}

			await task.say("codebase_search_result", JSON.stringify({ tool: "codebaseSearch", content: jsonResult }))

			const output = `Query: ${query}\nResults:\n\n${jsonResult.results
				.map(
					(r) =>
						`File path: ${r.filePath}\nScore: ${r.score}\nLines: ${r.startLine}-${r.endLine}\n${r.codeChunk ? `Code Chunk: ${r.codeChunk}\n` : ""}`,
				)
				.join("\n")}`

			pushToolResult(output)
		} catch (error) {
			await handleError("semantic_search", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"semantic_search">): Promise<void> {
		const query = block.params.query
		const directoryPrefix = block.params.path

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query: this.removeClosingTag("query", query, block.partial),
			path: this.removeClosingTag("path", directoryPrefix, block.partial),
		}

		await task.ask("tool", JSON.stringify({ ...sharedMessageProps, content: "" }), block.partial).catch(() => {})
	}
}

export const semanticSearchTool = new SemanticSearchTool()
