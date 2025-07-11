import path from "path"
import delay from "delay"
import * as vscode from "vscode"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { MorphFastApplyDiffStrategy } from "../diff/strategies/morph-fast-apply"
import { MorphFastApplyOptions } from "../../api/providers/morph-fast-apply"

export async function morphSemanticEditTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path
	let instruction: string | undefined = block.params.instruction
	let editSnippet: string | undefined = block.params.edit_snippet

	if (block.partial && (!relPath || !instruction || editSnippet === undefined)) {
		return
	}

	if (!relPath) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("morph_semantic_edit")
		pushToolResult(await cline.sayAndCreateMissingParamError("morph_semantic_edit", "path"))
		await cline.diffViewProvider.reset()
		return
	}

	if (!instruction) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("morph_semantic_edit")
		pushToolResult(await cline.sayAndCreateMissingParamError("morph_semantic_edit", "instruction"))
		await cline.diffViewProvider.reset()
		return
	}

	if (editSnippet === undefined) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("morph_semantic_edit")
		pushToolResult(await cline.sayAndCreateMissingParamError("morph_semantic_edit", "edit_snippet"))
		await cline.diffViewProvider.reset()
		return
	}

	const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)

	if (!accessAllowed) {
		await cline.say("rooignore_error", relPath)
		pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
		return
	}

	// Check if file is write-protected
	const isWriteProtected = cline.rooProtectedController?.isWriteProtected(relPath) || false

	// Check if file exists
	const absolutePath = path.resolve(cline.cwd, relPath)
	const fileExists = await fileExistsAtPath(absolutePath)

	if (!fileExists) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("morph_semantic_edit")
		const formattedError = formatResponse.toolError(
			`File does not exist at path: ${absolutePath}\nThe specified file could not be found. Please verify the file path and try again.`,
		)
		await cline.say("error", formattedError)
		pushToolResult(formattedError)
		return
	}

	// Determine if the path is outside the workspace
	const fullPath = path.resolve(cline.cwd, removeClosingTag("path", relPath))
	const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

	// Pre-process content for weaker models
	if (!cline.api.getModel().id.includes("claude")) {
		instruction = unescapeHtmlEntities(instruction)
		editSnippet = unescapeHtmlEntities(editSnippet)
	}

	const sharedMessageProps: ClineSayTool = {
		tool: "morphSemanticEdit",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
		instruction: instruction,
		editSnippet: editSnippet,
		isOutsideWorkspace,
		isProtected: isWriteProtected,
	}

	try {
		if (block.partial) {
			// Update GUI message
			const partialMessage = JSON.stringify(sharedMessageProps)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		}

		// Reset consecutive mistakes since all validations passed
		cline.consecutiveMistakeCount = 0

		// Initialize Morph Fast Apply strategy
		const morphOptions: MorphFastApplyOptions = {
			// Use OpenRouter by default as it's more widely available
			provider: 'openrouter',
			morphModel: 'morph/morph-v3-fast',
			openRouterApiKey: cline.api.getApiKey(),
			// Fallback to direct Morph API if needed
			morphApiKey: process.env.MORPH_API_KEY,
			timeout: 30000,
		}

		const morphStrategy = new MorphFastApplyDiffStrategy(morphOptions)

		// Check if Morph is available
		const isAvailable = await morphStrategy.isAvailable()
		if (!isAvailable) {
			// Fallback to existing diff strategy
			pushToolResult(formatResponse.toolError(
				`Morph Fast Apply is not available. Please check your API key configuration or use traditional diff tools instead.`
			))
			return
		}

		// Read original content
		const fs = await import("fs/promises")
		const originalContent = await fs.readFile(absolutePath, "utf-8")

		// Prepare diff view
		cline.diffViewProvider.editType = "modify"
		cline.diffViewProvider.originalContent = originalContent

		// Show processing message
		const processingMessage = JSON.stringify({
			...sharedMessageProps,
			isProcessing: true,
		} satisfies ClineSayTool)
		await cline.ask("tool", processingMessage, true).catch(() => {})

		// Apply semantic edit using Morph
		const diffResult = await morphStrategy.applyDiff(
			originalContent,
			`<instruction>${instruction}</instruction>\n<edit_snippet>${editSnippet}</edit_snippet>`
		)

		if (!diffResult.success) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("morph_semantic_edit")
			
			const formattedError = formatResponse.toolError(
				`Morph Fast Apply failed: ${diffResult.error || 'Unknown error'}`
			)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			await cline.diffViewProvider.reset()
			return
		}

		const newContent = diffResult.content

		// Show changes in diff view
		if (!cline.diffViewProvider.isEditing) {
			await cline.diffViewProvider.open(relPath)
		}

		await cline.diffViewProvider.update(newContent, true)
		await delay(300) // Wait for diff view to update
		cline.diffViewProvider.scrollToFirstDiff()

		// Generate and validate diff
		const diff = formatResponse.createPrettyPatch(relPath, originalContent, newContent)
		if (!diff) {
			pushToolResult(`No changes detected for '${relPath}' after Morph Fast Apply`)
			await cline.diffViewProvider.reset()
			return
		}

		// Request user approval for changes
		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			diff,
			isProtected: isWriteProtected,
		} satisfies ClineSayTool)

		const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

		if (!didApprove) {
			await cline.diffViewProvider.revertChanges()
			pushToolResult("Changes were rejected by the user.")
			await cline.diffViewProvider.reset()
			return
		}

		// Call saveChanges to update the DiffViewProvider properties
		await cline.diffViewProvider.saveChanges()

		// Track file edit operation
		await cline.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)

		cline.didEditFile = true

		// Get the formatted response message
		const message = await cline.diffViewProvider.pushToolWriteResult(
			cline,
			cline.cwd,
			false, // Always false for semantic edit (file must exist)
		)

		pushToolResult(message)

		// Record successful tool usage and cleanup
		cline.recordToolUsage("morph_semantic_edit")
		await cline.diffViewProvider.reset()

	} catch (error) {
		await handleError("morph semantic edit", error)
		await cline.diffViewProvider.reset()
	}
} 