import * as vscode from "vscode"

import { Task } from "../task/Task"
import { CodeIndexManager } from "../../services/code-index/manager"
import { getWorkspacePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag, ToolUse } from "../../shared/tools"
import path from "path"
import { ManagedIndexer } from "../../services/code-index/managed/ManagedIndexer"

export async function codebaseSearchTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const toolName = "codebase_search"
	const workspacePath = cline.cwd && cline.cwd.trim() !== "" ? cline.cwd : getWorkspacePath()

	if (!workspacePath) {
		// This case should ideally not happen if Cline is initialized correctly
		await handleError(toolName, new Error("Could not determine workspace path."))
		return
	}

	// --- Parameter Extraction and Validation ---
	let query: string | undefined = block.params.query
	let directoryPrefix: string | undefined = block.params.path

	query = removeClosingTag("query", query)

	if (directoryPrefix) {
		directoryPrefix = removeClosingTag("path", directoryPrefix)
		directoryPrefix = path.normalize(directoryPrefix)
	}

	const sharedMessageProps = {
		tool: "codebaseSearch",
		query: query,
		path: directoryPrefix,
		isOutsideWorkspace: false,
	}

	if (block.partial) {
		await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
		return
	}

	if (!query) {
		cline.consecutiveMistakeCount++
		pushToolResult(await cline.sayAndCreateMissingParamError(toolName, "query"))
		return
	}

	const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
	if (!didApprove) {
		pushToolResult(formatResponse.toolDenied())
		return
	}

	cline.consecutiveMistakeCount = 0

	// kilode_change start - First try mnaaged indexing
	if (await tryManagedSearch(cline, pushToolResult, query, directoryPrefix)) {
		return
	}
	// kilode_change end - First try mnaaged indexing

	// --- Core Logic ---
	try {
		const context = cline.providerRef.deref()?.context
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

		// kilocode_change start
		const status = manager.getCurrentStatus()
		if (status.systemStatus !== "Indexed") {
			const defaultStatusMessage = (() => {
				switch (status.systemStatus) {
					case "Indexing":
						return "Code indexing is still running"
					case "Standby":
						return "Code indexing has not started"
					case "Error":
						return "Code indexing is in an error state"
					default:
						return "Code indexing is not ready"
				}
			})()

			const normalizedMessage =
				status.message && status.message.trim() !== "" ? status.message.trim() : defaultStatusMessage
			const unit =
				status.currentItemUnit && status.currentItemUnit.trim() !== "" ? status.currentItemUnit : "items"
			const progress = status.totalItems > 0 ? `${status.processedItems}/${status.totalItems} ${unit}` : undefined
			const messageWithoutTrailingPeriod = normalizedMessage.endsWith(".")
				? normalizedMessage.slice(0, -1)
				: normalizedMessage
			const friendlyMessage = progress
				? `${messageWithoutTrailingPeriod} (Progress: ${progress}).`
				: `${messageWithoutTrailingPeriod}.`

			const payload = {
				tool: "codebaseSearch",
				content: {
					query,
					results: [] as VectorStoreSearchResult[],
					status: {
						systemStatus: status.systemStatus,
						message: normalizedMessage,
						processedItems: status.processedItems,
						totalItems: status.totalItems,
						currentItemUnit: status.currentItemUnit,
					},
				},
			}

			await cline.say("codebase_search_result", JSON.stringify(payload))
			pushToolResult(
				formatResponse.toolError(
					`${friendlyMessage} Semantic search is unavailable until indexing completes. Please try again later.`,
				),
			)
			return
		}
		// kilocode_change end

		const searchResults: VectorStoreSearchResult[] = await manager.searchIndex(query, directoryPrefix)

		// 3. Format and push results
		if (!searchResults || searchResults.length === 0) {
			pushToolResult(`No relevant code snippets found for the query: "${query}"`) // Use simple string for no results
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

		// Send results to UI
		const payload = { tool: "codebaseSearch", content: jsonResult }
		await cline.say("codebase_search_result", JSON.stringify(payload))

		// Push results to AI
		const output = `Query: ${query}
Results:

${jsonResult.results
	.map(
		(result) => `File path: ${result.filePath}
Score: ${result.score}
Lines: ${result.startLine}-${result.endLine}
${result.codeChunk ? `Code Chunk: ${result.codeChunk}\n` : ""}`, // kilocode_change - don't include code chunk managed indexing
	)
	.join("\n")}`

		pushToolResult(output)
	} catch (error: any) {
		await handleError(toolName, error) // Use the standard error handler
	}
}

// kilocode_change start - Add managed search block
async function tryManagedSearch(
	cline: Task,
	pushToolResult: PushToolResult,
	query: string,
	directoryPrefix?: string,
): Promise<boolean> {
	try {
		const managed = ManagedIndexer.getInstance()
		if (!managed.isEnabled()) {
			return false
		}
		const searchResults = await managed.search(query, directoryPrefix)
		// 3. Format and push results
		if (!searchResults || searchResults.length === 0) {
			pushToolResult(`No relevant code snippets found for the query: "${query}"`) // Use simple string for no results
			return true
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

		// Send results to UI
		const payload = { tool: "codebaseSearch", content: jsonResult }
		await cline.say("codebase_search_result", JSON.stringify(payload))

		// Push results to AI
		const output = `Query: ${query}
Results:

${jsonResult.results
	.map(
		(result) => `File path: ${result.filePath}
Score: ${result.score}
Lines: ${result.startLine}-${result.endLine}
${result.codeChunk ? `Code Chunk: ${result.codeChunk}\n` : ""}`, // kilocode_change - don't include code chunk managed indexing
	)
	.join("\n")}`

		pushToolResult(output)
		return true
	} catch (e) {
		console.log(`[codebaseSearchTool]: Managed search failed with error: ${e}`)
		return false
	}
}
// kilocode_change end - Add managed search block
