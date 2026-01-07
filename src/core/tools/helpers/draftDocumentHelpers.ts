// kilocode_change - new file
import * as vscode from "vscode"
import { addLineNumbers } from "../../../integrations/misc/extract-text"
import {
	isDraftPath,
	normalizeDraftPath,
	draftPathToFilename,
	DRAFT_SCHEME_NAME,
	getDraftFileSystem,
} from "../../../services/planning"
import type { Task } from "../../task/Task"
import type { RecordSource } from "../../context-tracking/FileContextTrackerTypes"

export { isDraftPath, normalizeDraftPath, draftPathToFilename, DRAFT_SCHEME_NAME }

/**
 * Read a draft document and return formatted result.
 * Shared helper for both ReadFileTool and simpleReadFileTool.
 */
export async function readDraftDocument(
	relPath: string,
	task: Task,
): Promise<{
	status: "approved" | "error"
	xmlContent?: string
	nativeContent?: string
	error?: string
}> {
	console.log("📝 [readDraftDocument] START - relPath:", relPath)
	const canonicalPath = normalizeDraftPath(relPath)
	const filename = draftPathToFilename(relPath)
	console.log("📝 [readDraftDocument] normalized - canonicalPath:", canonicalPath, "filename:", filename)

	try {
		const uri = vscode.Uri.parse(`${DRAFT_SCHEME_NAME}:/${filename}`)
		console.log("📝 [readDraftDocument] constructed URI:", uri.toString())
		console.log("📝 [readDraftDocument] calling vscode.workspace.fs.readFile...")
		const contentBytes = await vscode.workspace.fs.readFile(uri)
		console.log("📝 [readDraftDocument] vscode.workspace.fs.readFile SUCCESS, size:", contentBytes.length)
		const content = new TextDecoder().decode(contentBytes)
		const numberedContent = addLineNumbers(content)
		const totalLines = content.split("\n").length
		console.log("📝 [readDraftDocument] decoded content, totalLines:", totalLines)

		await task.fileContextTracker.trackFileContext(canonicalPath, "read_tool" as RecordSource)

		const lineRangeAttr = ` lines="1-${totalLines}"`
		const xmlInfo = totalLines > 0 ? `<content${lineRangeAttr}>\n${numberedContent}</content>\n` : `<content/>`
		const nativeInfo =
			totalLines > 0
				? `File: ${canonicalPath}\nLines: 1-${totalLines}\n\n${numberedContent}`
				: `File: ${canonicalPath}\n(empty file)`

		console.log("📝 [readDraftDocument] SUCCESS - returning content")
		return {
			status: "approved",
			xmlContent: `<file><path>${canonicalPath}</path>\n${xmlInfo}</file>`,
			nativeContent: nativeInfo,
		}
	} catch (error) {
		const isNotFoundError = error instanceof Error && error.message.includes("FileNotFound")
		const errorMsg = error instanceof Error ? error.message : "Unknown error"
		console.error("📝 [readDraftDocument] ERROR:", errorMsg)
		if (error instanceof Error) {
			console.error("📝 [readDraftDocument] ERROR stack:", error.stack)
		}

		if (isNotFoundError) {
			const draftName = filename.replace(/\.plan\.md$/, "").replace(/\.md$/, "")
			console.log("📝 [readDraftDocument] returning FileNotFound error for draft:", draftName)
			return {
				status: "error",
				error: `Draft document "${draftName}" does not exist. Use the create_draft tool to create it.`,
				xmlContent: `<file><path>${canonicalPath}</path><error>Draft document "${draftName}" does not exist. Use the create_draft tool with a title and content to create a new draft document.</error></file>`,
				nativeContent: `File: ${canonicalPath}\nError: Draft document "${draftName}" does not exist. Use the create_draft tool with a title and content to create a new draft document.`,
			}
		}

		console.log("📝 [readDraftDocument] returning generic error")
		return {
			status: "error",
			error: `Error reading draft document: ${errorMsg}`,
			xmlContent: `<file><path>${canonicalPath}</path><error>Error reading draft document: ${errorMsg}</error></file>`,
			nativeContent: `File: ${canonicalPath}\nError: Error reading draft document: ${errorMsg}`,
		}
	}
}

/**
 * Write content to a draft document.
 * Helper for WriteToFileTool.
 */
export async function writeDraftDocument(
	relPath: string,
	content: string,
	task: Task,
): Promise<{ canonicalPath: string } | { error: string }> {
	console.log("📝 [writeDraftDocument] START - relPath:", relPath, "contentLength:", content.length)
	const canonicalPath = normalizeDraftPath(relPath)
	const filename = draftPathToFilename(relPath)
	console.log("📝 [writeDraftDocument] normalized - canonicalPath:", canonicalPath, "filename:", filename)

	try {
		// Check if draft exists before writing
		const draftFs = getDraftFileSystem()
		console.log("📝 [writeDraftDocument] checking if draft exists...")
		const wasNew = !(await draftFs.draftExists(canonicalPath))
		console.log("📝 [writeDraftDocument] draft exists check - wasNew:", wasNew)

		const uri = vscode.Uri.parse(`${DRAFT_SCHEME_NAME}:/${filename}`)
		console.log("📝 [writeDraftDocument] constructed URI:", uri.toString())
		const contentBytes = new TextEncoder().encode(content)
		console.log("📝 [writeDraftDocument] calling vscode.workspace.fs.writeFile...")
		await vscode.workspace.fs.writeFile(uri, contentBytes)
		console.log("📝 [writeDraftDocument] vscode.workspace.fs.writeFile SUCCESS")

		// If this is a new draft document, open it in VS Code
		if (wasNew) {
			console.log("📝 [writeDraftDocument] opening new draft document in editor")
			await vscode.window.showTextDocument(uri, { preview: false })
		}

		await task.fileContextTracker.trackFileContext(canonicalPath, "roo_edited" as RecordSource)
		console.log("📝 [writeDraftDocument] SUCCESS - returning canonicalPath:", canonicalPath)
		return { canonicalPath }
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : "Unknown error"
		console.error("📝 [writeDraftDocument] ERROR:", errorMsg)
		if (error instanceof Error) {
			console.error("📝 [writeDraftDocument] ERROR stack:", error.stack)
		}
		return { error: `Error writing draft document: ${errorMsg}` }
	}
}

/**
 * Check if a path is a draft document path.
 * Convenience function that re-exports from draftPaths.
 */
export function isDraftDocumentPath(path: string): boolean {
	return isDraftPath(path)
}
