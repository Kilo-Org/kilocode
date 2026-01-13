import path from "path"
import { promises as fs } from "fs"
import OpenAI from "openai"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { fileExistsAtPath } from "../../../utils/fs"
import { getReadablePath } from "../../../utils/path"
import { FastApplyApiProvider, fastApplyApiProviderSchema, getKiloUrlFromToken } from "@roo-code/types"
import { DEFAULT_HEADERS } from "../../../api/providers/constants"
import { TelemetryService } from "@roo-code/telemetry"
import { type ClineProviderState } from "../../webview/ClineProvider"
import { ClineSayTool } from "../../../shared/ExtensionMessage"
import { X_KILOCODE_ORGANIZATIONID, X_KILOCODE_TASKID, X_KILOCODE_TESTER } from "../../../shared/kilocode/headers"
import { trackContribution } from "../../../services/contribution-tracking/ContributionTrackingService"
import { sanitizeUnifiedDiff } from "../../diff/stats"

const FAST_APPLY_MODEL_PRICING = {
	"morph-v3-fast": {
		inputPrice: 0.8, // $0.8 per 1M tokens
		outputPrice: 1.2, // $1.2 per 1M tokens
	},
	"morph-v3-large": {
		inputPrice: 0.9, // $0.9 per 1M tokens
		outputPrice: 1.9, // $1.9 per 1M tokens
	},
	"relace-apply-3": {
		inputPrice: 0.85, // $0.85 per 1M tokens
		outputPrice: 1.25, // $1.25 per 1M tokens
	},
	auto: {
		inputPrice: 0.9, // Default to morph-v3-large pricing
		outputPrice: 1.9,
	},
} as const

function calculateFastApplyCost(inputTokens: number, outputTokens: number, model: string): number {
	const normalizedModel = model.replace(/^(morph|relace)\//, "") // Remove provider prefix if present
	const pricing =
		FAST_APPLY_MODEL_PRICING[normalizedModel as keyof typeof FAST_APPLY_MODEL_PRICING] ||
		FAST_APPLY_MODEL_PRICING["auto"]

	const inputCost = (pricing.inputPrice / 1_000_000) * inputTokens
	const outputCost = (pricing.outputPrice / 1_000_000) * outputTokens

	return inputCost + outputCost
}

async function validateParams(
	cline: Task,
	targetFile: string | undefined,
	instructions: string | undefined,
	codeEdit: string | undefined,
	pushToolResult: PushToolResult,
): Promise<boolean> {
	if (!targetFile) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("fast_edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("fast_edit_file", "target_file"))
		return false
	}

	if (!instructions) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("fast_edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("fast_edit_file", "instructions"))
		return false
	}

	if (codeEdit === undefined) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("fast_edit_file")
		pushToolResult(await cline.sayAndCreateMissingParamError("fast_edit_file", "code_edit"))
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

	let fileExists = true
	try {
		if (block.partial && (!target_file || instructions === undefined)) {
			// wait so we can determine if it's a new file or editing an existing file
			return
		}
		fileExists = await fileExistsAtPath(path.resolve(cline.cwd, target_file ?? ""))

		// Handle partial tool use
		if (block.partial) {
			const partialMessageProps = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: getReadablePath(cline.cwd, removeClosingTag("target_file", target_file)),
				content: removeClosingTag("code_edit", code_edit),
			} satisfies ClineSayTool
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {
				// Roo tools ignore exceptions as well here
			})
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

		// Check if file access is allowed
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await cline.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		// Read the original file content
		const originalContent = fileExists ? await fs.readFile(absolutePath, "utf-8") : ""

		// Check if Fast Apply is available
		const morphApplyResult = fileExists
			? await applyFastApplyEdit(originalContent, editInstructions, editCode, cline, relPath)
			: undefined

		if (morphApplyResult && !morphApplyResult.success) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("fast_edit_file")
			const error = `Failed to apply edit using Fast Apply. Please disable the Fast Apply experimental feature if this error persists. ${morphApplyResult.error}`
			cline.say("error", error)
			pushToolResult(formatResponse.toolError(error))
			return
		}

		const newContent = morphApplyResult?.result ?? code_edit ?? ""

		// Show the diff and ask for approval
		cline.diffViewProvider.editType = fileExists ? "modify" : "create"
		await cline.diffViewProvider.open(relPath)

		// Stream the content to show the diff
		await cline.diffViewProvider.update(newContent, true)
		cline.diffViewProvider.scrollToFirstDiff()

		// Ask for user approval
		const approved = await askApproval(
			"tool",
			JSON.stringify({
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: relPath,
				isProtected: cline.rooProtectedController?.isWriteProtected(relPath) || false,
				content: editCode,
				fastApplyResult: morphApplyResult
					? {
							description: morphApplyResult.description,
							tokensIn: morphApplyResult.tokensIn,
							tokensOut: morphApplyResult.tokensOut,
							cost: morphApplyResult.cost,
						}
					: undefined,
			} satisfies ClineSayTool),
			undefined,
			cline.rooProtectedController?.isWriteProtected(relPath) || false,
		)

		// Track contribution (fire-and-forget, never blocks user workflow)
		const provider = cline.providerRef.deref()
		const state = await provider?.getState()
		const unifiedPatchRaw = formatResponse.createPrettyPatch(relPath, originalContent, newContent)
		const unifiedPatch = sanitizeUnifiedDiff(unifiedPatchRaw)
		trackContribution({
			cwd: cline.cwd,
			filePath: relPath,
			unifiedDiff: unifiedPatch,
			status: approved ? "accepted" : "rejected",
			taskId: cline.taskId,
			organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
			kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
		})

		if (!approved) {
			await cline.diffViewProvider.revertChanges()
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

		// Process any queued messages after file edit completes
		cline.processQueuedMessages()
	} catch (error) {
		TelemetryService.instance.captureException(error, { context: "editFileTool" })
		await handleError("editing file with Fast Apply", error as Error)
		await cline.diffViewProvider.reset()
	}
}

interface MorphApplyResult {
	success: boolean
	result?: string
	error?: string
	description?: string
	tokensIn?: number
	tokensOut?: number
	cost?: number
}

async function applyFastApplyEdit(
	originalContent: string,
	instructions: string,
	codeEdit: string,
	cline: Task,
	filePath: string,
): Promise<MorphApplyResult> {
	try {
		// Get the current API configuration
		const provider = cline.providerRef.deref()
		if (!provider) {
			return { success: false, error: "No API provider available for Fast Apply" }
		}

		const state = await provider.getState()

		// Check if user has Fast Apply enabled via OpenRouter or direct API
		const morphConfig = await getFastApplyConfiguration(state)
		if (!morphConfig.available) {
			return { success: false, error: morphConfig.error || "Fast Apply is not available" }
		}

		// Create a verbose request description similar to regular API requests
		const fileName = filePath ? path.basename(filePath) : "unknown file"
		const truncatedCodeEdit = codeEdit.length > 500 ? codeEdit.substring(0, 500) + "\n...(truncated)" : codeEdit
		const description = [
			`Fast Apply Edit (${morphConfig.model})`,
			``,
			`File: ${fileName}`,
			`Instructions: ${instructions}`,
			``,
			`Code Edit:`,
			"```",
			truncatedCodeEdit,
			"```",
			``,
			`Original Content: ${originalContent.length} characters`,
		].join("\n")

		const kiloTesterSuppressUntil = state.apiConfiguration.kilocodeTesterWarningsDisabledUntil
		const kiloTesterSuppress =
			kiloTesterSuppressUntil && kiloTesterSuppressUntil > Date.now() ? { [X_KILOCODE_TESTER]: "SUPPRESS" } : {}
		// Create OpenAI client for Morph API
		const client = new OpenAI({
			apiKey: morphConfig.apiKey,
			baseURL: morphConfig.baseUrl,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(morphConfig.kiloCodeOrganizationId
					? { [X_KILOCODE_ORGANIZATIONID]: morphConfig.kiloCodeOrganizationId }
					: {}),
				...kiloTesterSuppress,
				[X_KILOCODE_TASKID]: cline.taskId,
			},
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

		// Extract usage information from response
		const usage = response.usage
		const tokensIn = usage?.prompt_tokens || 0
		const tokensOut = usage?.completion_tokens || 0
		const cost = calculateFastApplyCost(tokensIn, tokensOut, morphConfig.model!)

		return {
			success: true,
			result: mergedCode,
			description,
			tokensIn,
			tokensOut,
			cost,
		}
	} catch (error) {
		TelemetryService.instance.captureException(error, { context: "applyFastApplyEdit" })
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		}
	}
}

interface FastApplyConfiguration {
	available: boolean
	apiKey?: string
	baseUrl?: string
	model?: string
	error?: string
	kiloCodeOrganizationId?: string
}

function getFastApplyConfiguration(state: ClineProviderState): FastApplyConfiguration {
	// Check if Fast Apply is enabled in API configuration
	if (state?.experiments?.morphFastApply !== true) {
		return {
			available: false,
			error: "Fast Apply is disabled. Enable it in API Options > Enable Editing with Fast Apply",
		}
	}

	// Read the selected model from state
	const selectedModel = state.fastApplyModel || "auto"

	let apiProvider: FastApplyApiProvider | undefined
	if (state.fastApplyApiProvider === "current") {
		const provider = fastApplyApiProviderSchema.safeParse(state.apiConfiguration?.apiProvider)
		if (provider.success) {
			apiProvider = provider.data
		} else {
			apiProvider = undefined
		}
	} else {
		apiProvider = state.fastApplyApiProvider
	}

	const useCurrentApiConfiguration = state.fastApplyApiProvider === "current"

	// Priority 1: Use direct Morph API key if available
	// Allow human-relay for debugging
	if (apiProvider === "morph" && state.morphApiKey) {
		const [org, model] = selectedModel.split("/")
		return {
			available: true,
			apiKey: state.morphApiKey,
			baseUrl: "https://api.morphllm.com/v1",
			model: org === "morph" ? model : "auto", // Use selected model instead of hardcoded "auto"
		}
	}

	// Priority 2: Use KiloCode provider
	if (apiProvider === "kilocode") {
		const token = useCurrentApiConfiguration ? state.apiConfiguration.kilocodeToken : state.morphApiKey
		if (!token) {
			return { available: false, error: "No KiloCode token available to use Fast Apply" }
		}
		const url = getKiloUrlFromToken("https://api.kilo.ai/api/openrouter/", token)

		return {
			available: true,
			apiKey: token,
			baseUrl: url,
			model: selectedModel === "auto" ? "morph/morph-v3-large" : selectedModel, // Use selected model
			kiloCodeOrganizationId: state.apiConfiguration.kilocodeOrganizationId,
		}
	}

	// Priority 3: Use OpenRouter provider
	if (apiProvider === "openrouter") {
		const token = useCurrentApiConfiguration ? state.apiConfiguration.openRouterApiKey : state.morphApiKey
		if (!token) {
			return { available: false, error: "No OpenRouter API token available to use Fast Apply" }
		}
		return {
			available: true,
			apiKey: token,
			baseUrl: useCurrentApiConfiguration
				? state.apiConfiguration.openRouterBaseUrl
				: "https://openrouter.ai/api/v1",
			model: selectedModel === "auto" ? "morph/morph-v3-large" : selectedModel, // Use selected model
		}
	}

	return {
		available: false,
		error: "Fast Apply configuration error. Please check your settings.",
	}
}

export function isFastApplyAvailable(state?: ClineProviderState): boolean {
	return (state && getFastApplyConfiguration(state).available) || false
}

export function getFastApplyModelType(state?: ClineProviderState): "Morph" | "Relace" {
	return state && getFastApplyConfiguration(state).model?.startsWith("relace/") ? "Relace" : "Morph"
}
