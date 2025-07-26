import path from "path"
import { promises as fs } from "fs"
import OpenAI from "openai"
import * as vscode from "vscode"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"

async function validateParams(
	cline: Task,
	targetFile: string | undefined,
	instructions: string | undefined,
	codeEdit: string | undefined,
	pushToolResult: PushToolResult,
): Promise<boolean> {
	console.log("[MORPH DEBUG] validateParams called with params:", {
		targetFile,
		instructions,
		codeEdit,
	})

	if (!targetFile) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("edit_file", "target_file"))
		return false
	}

	if (!instructions) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("edit_file", "instructions"))
		return false
	}

	if (codeEdit === undefined) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("edit_file", "code_edit"))
		return false
	}

	return true
}

export async function editFileTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
): Promise<void> {
	const target_file: string | undefined = block.params.target_file
	const instructions: string | undefined = block.params.instructions
	const code_edit: string | undefined = block.params.code_edit

	try {
		// Handle partial tool use
		if (block.partial) {
			const partialMessageProps = {
				tool: "editFile" as const,
				path: getReadablePath(cline.cwd, removeClosingTag("target_file", target_file)),
				instructions: removeClosingTag("instructions", instructions),
				codeEdit: removeClosingTag("code_edit", code_edit),
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// Validate required parameters
		if (!(await validateParams(cline, target_file, instructions, code_edit, pushToolResult))) {
			return
		}

		// At this point we know all parameters are defined, so we can safely cast them
		const targetFile = target_file as string
		const editInstructions = instructions as string
		const editCode = code_edit as string

		// Validate and resolve the file path
		const absolutePath = path.resolve(cline.cwd, targetFile)
		const relPath = getReadablePath(cline.cwd, absolutePath)

		// Check if file exists
		if (!(await fileExistsAtPath(absolutePath))) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("edit_file")
			pushToolResult(
				formatResponse.toolError(
					`The file ${relPath} does not exist. Use write_to_file to create new files, or make sure the file path is correct.`,
				),
			)
			return
		}

		// Check if file access is allowed
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await cline.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		// Read the original file content
		const originalContent = await fs.readFile(absolutePath, "utf-8")

		// Check if Morph is available
		const morphApplyResult = await applyMorphEdit(originalContent, editInstructions, editCode, cline)

		if (!morphApplyResult.success) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("edit_file")
			pushToolResult(
				formatResponse.toolError(
					`Failed to apply edit using Morph: ${morphApplyResult.error}. Consider using apply_diff tool instead.`,
				),
			)
			return
		}

		const newContent = morphApplyResult.result!

		// Show the diff and ask for approval
		cline.diffViewProvider.editType = "modify"
		await cline.diffViewProvider.open(relPath)

		// Stream the content to show the diff
		await cline.diffViewProvider.update(newContent, true)
		cline.diffViewProvider.scrollToFirstDiff()

		// Ask for user approval
		const approved = await askApproval(
			"tool",
			JSON.stringify({
				tool: "editedExistingFile",
				path: relPath,
				isProtected: cline.rooProtectedController?.isWriteProtected(relPath) || false,
				instructions: editInstructions,
			}),
			undefined,
			cline.rooProtectedController?.isWriteProtected(relPath) || false,
		)

		if (!approved) {
			await cline.diffViewProvider.revertChanges()
			pushToolResult(formatResponse.toolResult("Edit cancelled by user."))
			return
		}

		// Apply the changes
		await cline.diffViewProvider.saveChanges()

		// Track file context
		await cline.fileContextTracker.trackFileContext(relPath, "roo_edited")
		cline.didEditFile = true
		cline.consecutiveMistakeCount = 0

		// Get the formatted response message
		const message = await cline.diffViewProvider.pushToolWriteResult(cline, cline.cwd, false)
		pushToolResult(message)

		await cline.diffViewProvider.reset()
	} catch (error) {
		await handleError("editing file with Morph", error as Error)
		await cline.diffViewProvider.reset()
	}
}

interface MorphApplyResult {
	success: boolean
	result?: string
	error?: string
}

async function applyMorphEdit(
	originalContent: string,
	instructions: string,
	codeEdit: string,
	cline: Task,
): Promise<MorphApplyResult> {
	try {
		// Get the current API configuration
		const provider = cline.providerRef.deref()
		if (!provider) {
			return { success: false, error: "No API provider available" }
		}

		const state = await provider.getState()
		const config = state.apiConfiguration

		// Check if user has Morph enabled via OpenRouter or direct API
		const morphConfig = await getMorphConfiguration(config)
		if (!morphConfig.available) {
			return { success: false, error: morphConfig.error || "Morph is not available" }
		}

		// Create OpenAI client for Morph API
		const client = new OpenAI({
			apiKey: morphConfig.apiKey,
			baseURL: morphConfig.baseUrl,
		})

		// Apply the edit using Morph's format
		const prompt = `<instructions>${instructions}</instructions>\n<code>${originalContent}</code>\n<update>${codeEdit}</update>`

		const response = await client.chat.completions.create(
			{
				model: morphConfig.model!,
				messages: [
					{
						role: "user",
						content: prompt,
					},
				],
			},
			{
				timeout: 30000, // 30 second timeout
			},
		)

		const mergedCode = response.choices[0]?.message?.content
		if (!mergedCode) {
			return { success: false, error: "Morph API returned empty response" }
		}

		return { success: true, result: mergedCode }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		}
	}
}

interface MorphConfiguration {
	available: boolean
	apiKey?: string
	baseUrl?: string
	model?: string
	error?: string
}

async function getMorphConfiguration(apiConfig: any): Promise<MorphConfiguration> {
	// Check if Morph is enabled in API configuration
	const morphEnabled = apiConfig.morphEnabled === true
	if (!morphEnabled) {
		return {
			available: false,
			error: "Morph is disabled. Enable it in API Options > Enable Editing with Morph FastApply",
		}
	}

	// If user is using OpenRouter as their provider, use Morph through OpenRouter
	if (apiConfig.apiProvider === "openrouter" && apiConfig.openRouterApiKey) {
		return {
			available: true,
			apiKey: apiConfig.openRouterApiKey,
			baseUrl: apiConfig.openRouterBaseUrl || "https://openrouter.ai/api/v1",
			model: "morph/morph-v3-large", // Morph model via OpenRouter
		}
	}

	// Otherwise, if user has direct Morph API key, use it
	if (apiConfig.morphApiKey) {
		return {
			available: true,
			apiKey: apiConfig.morphApiKey,
			baseUrl: "https://api.morphllm.com/v1",
			model: "auto",
		}
	}

	return {
		available: false,
		error: "Morph is enabled but not configured. Either set a Morph API key in API Options or use OpenRouter with Morph access.",
	}
}
