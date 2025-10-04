// Utility functions for Grok model detection and handling
// kilocode_change: Grok XML tool call improvements

import { type ClineProviderState } from "../webview/ClineProvider"

/**
 * Detects if the current model is a Grok model based on model ID
 */
export function isGrokModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const lowerModelId = modelId.toLowerCase()
	return lowerModelId.includes("grok") || lowerModelId.startsWith("x-ai/grok") || lowerModelId.startsWith("xai/grok")
}

/**
 * Extracts model ID from provider state
 */
export function getModelIdFromState(state?: ClineProviderState): string | undefined {
	if (!state?.apiConfiguration) {
		return undefined
	}

	const config = state.apiConfiguration

	// Try various model ID fields based on provider
	switch (config.apiProvider) {
		case "xai":
			return config.apiModelId
		case "openrouter":
			return config.openRouterModelId
		case "kilocode":
			return config.kilocodeModel
		default:
			return config.apiModelId
	}
}

/**
 * Determines if we should use Grok-specific tool handling based on the current state
 */
export function shouldUseGrokToolHandling(state?: ClineProviderState): boolean {
	const modelId = getModelIdFromState(state)
	return isGrokModel(modelId)
}

/**
 * Gets Grok-specific XML tool call guidance to append to tool descriptions
 */
export function getGrokToolCallGuidance(): string {
	return `

**CRITICAL XML FORMATTING RULES:**
- ALL THREE parameters MUST be present and complete
- Use proper XML tag structure: opening and closing tags MUST match exactly
- NO prose or explanations mixed with tool calls
- Each parameter must be on its own line
- Close ALL tags properly before ending the tool call
- If uncertain about any parameter, DO NOT use this tool - use apply_diff instead`
}

/**
 * Validates edit_file tool parameters for completeness
 */
export interface EditFileValidationResult {
	isValid: boolean
	missingParams: string[]
	error?: string
}

export function validateEditFileParams(params: {
	target_file?: string
	instructions?: string
	code_edit?: string
}): EditFileValidationResult {
	const missingParams: string[] = []

	if (!params.target_file || params.target_file.trim() === "") {
		missingParams.push("target_file")
	}

	if (!params.instructions || params.instructions.trim() === "") {
		missingParams.push("instructions")
	}

	if (params.code_edit === undefined || params.code_edit === null) {
		missingParams.push("code_edit")
	}

	if (missingParams.length > 0) {
		return {
			isValid: false,
			missingParams,
			error: `Missing required parameters: ${missingParams.join(", ")}`,
		}
	}

	// Additional validation for suspiciously empty content
	if (params.target_file && params.target_file.trim().length === 0) {
		return {
			isValid: false,
			missingParams: ["target_file"],
			error: "target_file is empty",
		}
	}

	if (params.instructions && params.instructions.trim().length === 0) {
		return {
			isValid: false,
			missingParams: ["instructions"],
			error: "instructions is empty",
		}
	}

	return {
		isValid: true,
		missingParams: [],
	}
}
