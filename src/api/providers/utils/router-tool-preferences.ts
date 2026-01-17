import type { ModelInfo } from "@roo-code/types"

/**
 * Apply tool preferences for models accessed through dynamic routers (OpenRouter, Requesty).
 *
 * Different model families perform better with specific tools:
 * - OpenAI models: Better results with apply_patch instead of apply_diff/write_to_file
 * - Gemini models: Higher quality results with write_file and edit_file
 *
 * This function modifies the model info to apply these preferences consistently
 * across all dynamic router providers.
 *
 * @param modelId The model identifier (e.g., "openai/gpt-4", "google/gemini-2.5-pro")
 * @param info The original model info object
 * @returns A new model info object with tool preferences applied
 */
export function applyRouterToolPreferences(modelId: string, info: ModelInfo): ModelInfo {
	let result = info

	// For OpenAI models via routers, exclude write_to_file and apply_diff, and include apply_patch
	// This matches the behavior of the native OpenAI provider
	if (modelId.includes("openai")) {
		result = {
			...result,
			excludedTools: [...new Set([...(result.excludedTools || []), "apply_diff", "write_to_file"])],
			includedTools: [...new Set([...(result.includedTools || []), "apply_patch"])],
		}
	}

	// For Gemini models via routers, include write_file and edit_file
	// This matches the behavior of the native Gemini provider
	if (modelId.includes("gemini")) {
		result = {
			...result,
			excludedTools: [...new Set([...(result.excludedTools || []), "apply_diff"])],
			includedTools: [...new Set([...(result.includedTools || []), "write_file", "edit_file"])],
		}
	}

	return result
}
