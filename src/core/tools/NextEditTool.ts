/**
 * Next Edit Tool
 *
 * Provides a tool interface for starting and managing Next Edit sessions.
 * This tool allows the AI to initiate automated code editing workflows.
 *
 * @module NextEditTool
 */

import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import type { ToolName } from "@roo-code/types"

interface NextEditParams {
	/** The edit goal description */
	goal: string
	/** Optional workspace URI (defaults to current workspace) */
	workspaceUri?: string
	/** Optional include patterns */
	includePatterns?: string[]
	/** Optional exclude patterns */
	excludePatterns?: string[]
	/** Optional maximum files to analyze */
	maxFiles?: number
}

/**
 * Next Edit Tool for starting automated code editing sessions
 */
export class NextEditTool extends BaseTool<"next_edit"> {
	readonly name = "next_edit" as const

	parseLegacy(params: Partial<Record<string, string>>): NextEditParams {
		const argsXmlTag = params.args

		if (!argsXmlTag) {
			throw new Error("Missing args for next_edit tool")
		}

		// Parse XML args
		// Expected format: <args><goal>...</goal><workspaceUri>...</workspaceUri>...</args>
		const goalMatch = argsXmlTag.match(/<goal>([^<]+)<\/goal>/)
		const workspaceUriMatch = argsXmlTag.match(/<workspaceUri>([^<]+)<\/workspaceUri>/)
		const includePatternsMatch = argsXmlTag.match(/<includePatterns>([^<]+)<\/includePatterns>/)
		const excludePatternsMatch = argsXmlTag.match(/<excludePatterns>([^<]+)<\/excludePatterns>/)
		const maxFilesMatch = argsXmlTag.match(/<maxFiles>(\d+)<\/maxFiles>/)

		const goal = goalMatch?.[1]?.trim()
		if (!goal) {
			throw new Error("Missing required parameter: goal")
		}

		return {
			goal,
			workspaceUri: workspaceUriMatch?.[1]?.trim(),
			includePatterns: includePatternsMatch?.[1]
				?.trim()
				.split(",")
				.map((p) => p.trim()),
			excludePatterns: excludePatternsMatch?.[1]
				?.trim()
				.split(",")
				.map((p) => p.trim()),
			maxFiles: maxFilesMatch?.[1] ? parseInt(maxFilesMatch[1], 10) : undefined,
		}
	}

	async execute(params: NextEditParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			// Validate workspace
			const workspaceUri = params.workspaceUri || task.cwd
			if (!workspaceUri) {
				throw new Error("No workspace available")
			}

			// Notify user that Next Edit session is starting
			await task.say("text", `Starting Next Edit session...\n\nGoal: ${params.goal}\nWorkspace: ${workspaceUri}`)

			// Import NextEditSession service dynamically
			const { NextEditSession: NextEditSessionService } = await import("../../services/next-edit/NextEditSession")
			const { SessionStorage } = await import("../../services/next-edit/SessionStorage")
			const { EditAnalyzer } = await import("../../services/next-edit/EditAnalyzer")
			const { EditSequencer } = await import("../../services/next-edit/EditSequencer")
			const { EditExecutor } = await import("../../services/next-edit/EditExecutor")

			// Initialize services
			const context = (task as any).getContext ? (task as any).getContext() : undefined
			const storage = new SessionStorage(context)
			const analyzer = new EditAnalyzer(context)
			const sequencer = new EditSequencer()
			const executor = new EditExecutor(context)

			const sessionService = new NextEditSessionService(context, storage, analyzer, sequencer, executor)

			// Start session
			const session = await sessionService.start(workspaceUri, params.goal, {
				includePatterns: params.includePatterns,
				excludePatterns: params.excludePatterns,
				maxFiles: params.maxFiles,
			})

			// Get session progress
			const progress = await sessionService.getProgress(session.id)

			// Return result
			const result = `Next Edit session started successfully.\n\nSession ID: ${session.id}\nGoal: ${params.goal}\nTotal edits: ${progress.total}\n\nUse the Next Edit panel to review and apply edits.`

			pushToolResult(result)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			await task.say("error", `Failed to start Next Edit session: ${errorMsg}`)
			handleError("executing next_edit", error instanceof Error ? error : new Error(errorMsg))
			pushToolResult(`<error>Failed to start Next Edit session: ${errorMsg}</error>`)
		}
	}
}

export const nextEditTool = new NextEditTool()
