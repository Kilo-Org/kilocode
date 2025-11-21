import * as vscode from "vscode"
import path from "path"

import { Task } from "../task/Task"
import { CodeIndexManager } from "../../services/code-index/manager"
import { getWorkspacePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface CodebaseSearchParams {
	query: string
	path?: string
}

export class CodebaseSearchTool extends BaseTool<"codebase_search"> {
	readonly name = "codebase_search" as const

	parseLegacy(params: Partial<Record<string, string>>): CodebaseSearchParams {
		let query = params.query
		let directoryPrefix = params.path

		if (directoryPrefix) {
			directoryPrefix = path.normalize(directoryPrefix)
		}

		return {
			query: query || "",
			path: directoryPrefix,
		}
	}

	async execute(params: CodebaseSearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const { query, path: directoryPrefix } = params

		const workspacePath = task.cwd && task.cwd.trim() !== "" ? task.cwd : getWorkspacePath()

		if (!workspacePath) {
			await handleError("codebase_search", new Error("Could not determine workspace path."))
			return
		}

		if (!query) {
			task.consecutiveMistakeCount++
			pushToolResult(await task.sayAndCreateMissingParamError("codebase_search", "query"))
			return
		}

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query: query,
			path: directoryPrefix,
			isOutsideWorkspace: false,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		try {
			const context = task.providerRef.deref()?.context
			if (!context) {
				throw new Error("Extension context is not available.")
			}

			const manager = CodeIndexManager.getInstance(context)

			if (!manager) {
				throw new Error("CodeIndexManager is not available.")
			}

			if (!manager.isFeatureEnabled) {
				throw new Error("Code Indexing is disabled in the settings.")
			}
			if (!manager.isFeatureConfigured) {
				throw new Error("Code Indexing is not configured (Missing OpenAI Key or Qdrant URL).")
			}

			// Check if indexing is still in progress
			const status = manager.getCurrentStatus()
			if (status.systemStatus === "Indexing") {
				const progressInfo =
					"processedItems" in status && "totalItems" in status && "currentItemUnit" in status
						? ` (Progress: ${status.processedItems}/${status.totalItems} ${status.currentItemUnit})`
						: ""
				const errorMessage = `${status.message || "Indexing in progress"}${progressInfo}. Semantic search is unavailable until indexing completes. Please try again later.`

				const payload = {
					tool: "codebaseSearch",
					content: {
						query,
						results: [],
						status,
					},
				}
				await task.say("codebase_search_result", JSON.stringify(payload))
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const searchResults: VectorStoreSearchResult[] = await manager.searchIndex(query, directoryPrefix)

			if (!searchResults || searchResults.length === 0) {
				pushToolResult(`No relevant code snippets found for the query: "${query}"`)
				return
			}

			const jsonResult = {
				query,
				results: [],
			} as {
				query: string
				results: Array<{
					filePath: string
					score: number
					startLine: number
					endLine: number
					codeChunk: string
				}>
			}

			searchResults.forEach((result) => {
				if (!result.payload) return
				if (!("filePath" in result.payload)) return

				const relativePath = vscode.workspace.asRelativePath(result.payload.filePath, false)

				jsonResult.results.push({
					filePath: relativePath,
					score: result.score,
					startLine: result.payload.startLine,
					endLine: result.payload.endLine,
					codeChunk: result.payload.codeChunk.trim(),
				})
			})

			const payload = { tool: "codebaseSearch", content: jsonResult }
			await task.say("codebase_search_result", JSON.stringify(payload))

			const output = `Query: ${query}
Results:

${jsonResult.results
	.map(
		(result) => `File path: ${result.filePath}
Score: ${result.score}
Lines: ${result.startLine}-${result.endLine}
Code Chunk: ${result.codeChunk}
`,
	)
	.join("\n")}`

			pushToolResult(output)
		} catch (error: any) {
			await handleError("codebase_search", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"codebase_search">): Promise<void> {
		const query: string | undefined = block.params.query
		const directoryPrefix: string | undefined = block.params.path

		const sharedMessageProps = {
			tool: "codebaseSearch",
			query: query,
			path: directoryPrefix,
			isOutsideWorkspace: false,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const codebaseSearchTool = new CodebaseSearchTool()
