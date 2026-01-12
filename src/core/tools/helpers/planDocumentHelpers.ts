// kilocode_change - new file
import * as vscode from "vscode"
import { addLineNumbers } from "../../../integrations/misc/extract-text"
import {
	isPlanPath,
	normalizePlanPath,
	planPathToFilename,
	filenameToPlanPath,
	PLAN_SCHEME_NAME,
	getPlanFileSystem,
} from "../../../services/planning"
import type { Task } from "../../task/Task"
import type { RecordSource } from "../../context-tracking/FileContextTrackerTypes"

export { isPlanPath, normalizePlanPath, planPathToFilename, PLAN_SCHEME_NAME }

/**
 * Read a plan document and return formatted result.
 * Shared helper for both ReadFileTool and simpleReadFileTool.
 */
export async function readPlanDocument(
	relPath: string,
	task: Task,
): Promise<{
	status: "approved" | "error"
	xmlContent?: string
	nativeContent?: string
	error?: string
}> {
	const canonicalPath = normalizePlanPath(relPath)
	const filename = planPathToFilename(relPath)

	try {
		const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
		const contentBytes = await vscode.workspace.fs.readFile(uri)
		const content = new TextDecoder().decode(contentBytes)
		const numberedContent = addLineNumbers(content)
		const totalLines = content.split("\n").length

		await task.fileContextTracker.trackFileContext(canonicalPath, "read_tool" as RecordSource)

		const lineRangeAttr = ` lines="1-${totalLines}"`
		const xmlInfo = totalLines > 0 ? `<content${lineRangeAttr}>\n${numberedContent}</content>\n` : `<content/>`
		const nativeInfo =
			totalLines > 0
				? `File: ${canonicalPath}\nLines: 1-${totalLines}\n\n${numberedContent}`
				: `File: ${canonicalPath}\n(empty file)`

		return {
			status: "approved",
			xmlContent: `<file><path>${canonicalPath}</path>\n${xmlInfo}</file>`,
			nativeContent: nativeInfo,
		}
	} catch (error) {
		const isNotFoundError = error instanceof Error && error.message.includes("FileNotFound")
		const errorMsg = error instanceof Error ? error.message : "Unknown error"

		if (isNotFoundError) {
			const planName = filename.replace(/\.plan\.md$/, "").replace(/\.md$/, "")
			return {
				status: "error",
				error: `Plan document "${planName}" does not exist. Use the create_plan tool to create it.`,
				xmlContent: `<file><path>${canonicalPath}</path><error>Plan document "${planName}" does not exist. Use the create_plan tool with a title and content to create a new plan document.</error></file>`,
				nativeContent: `File: ${canonicalPath}\nError: Plan document "${planName}" does not exist. Use the create_plan tool with a title and content to create a new plan document.`,
			}
		}

		return {
			status: "error",
			error: `Error reading plan document: ${errorMsg}`,
			xmlContent: `<file><path>${canonicalPath}</path><error>Error reading plan document: ${errorMsg}</error></file>`,
			nativeContent: `File: ${canonicalPath}\nError: Error reading plan document: ${errorMsg}`,
		}
	}
}

/**
 * Write content to a plan document.
 * Helper for WriteToFileTool.
 */
export async function writePlanDocument(
	relPath: string,
	content: string,
	task: Task,
): Promise<{ canonicalPath: string } | { error: string }> {
	const canonicalPath = normalizePlanPath(relPath)
	const filename = planPathToFilename(relPath)

	try {
		// Check if plan exists before writing
		const planFs = getPlanFileSystem()
		const wasNew = !(await planFs.planExists(canonicalPath))

		const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
		const contentBytes = new TextEncoder().encode(content)
		await vscode.workspace.fs.writeFile(uri, contentBytes)

		// If this is a new plan document, open it in VS Code
		if (wasNew) {
			await vscode.window.showTextDocument(uri, { preview: false })
		}

		await task.fileContextTracker.trackFileContext(canonicalPath, "roo_edited" as RecordSource)
		return { canonicalPath }
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : "Unknown error"
		return { error: `Error writing plan document: ${errorMsg}` }
	}
}

/**
 * Check if a path is a plan document path.
 * Convenience function that re-exports from planPaths.
 */
export function isPlanDocumentPath(path: string): boolean {
	return isPlanPath(path)
}

/**
 * If the file path should be a plan document (absolute /plans/ path),
 * convert it to a plan:// URI. Returns undefined if not a /plans/ path.
 * Note: This only converts /plans/ paths, not already-converted plan:// paths.
 *
 * @param filePath - The file path to check and potentially convert
 * @returns The plan:// URI if the path should be converted, or undefined
 */
export function convertToPlanPathIfNeeded(filePath: string): string | undefined {
	// Only convert /plans/ paths (not already plan:// paths)
	if (filePath.startsWith("/plans/")) {
		// Extract filename from /plans/filename.md -> filename.md
		const filename = filePath.replace(/^\/plans\//, "").replace(/^\//, "")
		return filenameToPlanPath(filename)
	}
	return undefined
}

/**
 * Read a plan document and return raw content.
 * Simple helper for tools that need to process the content themselves.
 *
 * @param relPath - The plan document path (any variant)
 * @returns The content or an error
 */
export async function readPlanDocumentContent(relPath: string): Promise<{ content: string } | { error: string }> {
	const filename = planPathToFilename(relPath)

	try {
		const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
		const contentBytes = await vscode.workspace.fs.readFile(uri)
		const content = new TextDecoder().decode(contentBytes)
		return { content }
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : "Unknown error"
		return { error: `Failed to read plan document: ${errorMsg}` }
	}
}

/**
 * Write content to a plan document.
 * Simple helper that handles URI construction and file tracking.
 *
 * @param relPath - The plan document path (any variant)
 * @param content - The content to write
 * @param task - The task instance for file tracking
 * @returns The canonical path or an error
 */
export async function writePlanDocumentContent(
	relPath: string,
	content: string,
	task: Task,
): Promise<{ canonicalPath: string } | { error: string }> {
	const canonicalPath = normalizePlanPath(relPath)
	const filename = planPathToFilename(relPath)

	try {
		const uri = vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
		const contentBytes = new TextEncoder().encode(content)
		await vscode.workspace.fs.writeFile(uri, contentBytes)

		await task.fileContextTracker.trackFileContext(canonicalPath, "roo_edited" as RecordSource)
		task.didEditFile = true

		return { canonicalPath }
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : "Unknown error"
		return { error: `Failed to write plan document: ${errorMsg}` }
	}
}
