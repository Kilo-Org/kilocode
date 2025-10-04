import type { ModelInfo } from "@roo-code/types"
import type { ApiHandlerOptions } from "../../../shared/api"

/**
 * Merges default model info with custom model info if provided.
 * Custom model info takes precedence over default model info.
 *
 * @param defaultInfo - The default model information
 * @param options - API handler options that may contain customModelInfo
 * @returns Merged model information with custom overrides applied
 */
export function mergeModelInfo<T extends ModelInfo>(defaultInfo: T, options: ApiHandlerOptions): T {
	const customInfo = options.customModelInfo

	// If no custom info is provided, return the default info
	if (!customInfo) {
		return defaultInfo
	}

	// Clean up custom info to remove any problematic data
	const cleanedCustomInfo = { ...customInfo }

	// Filter out undefined/null values from custom info to avoid type conflicts
	const filteredCustomInfo: Partial<ModelInfo> = {}
	for (const [key, value] of Object.entries(cleanedCustomInfo)) {
		if (value !== undefined && value !== null) {
			;(filteredCustomInfo as any)[key] = value
		}
	}

	// Merge filtered custom info with default info, with custom taking precedence
	// Use type assertion to maintain the original type structure
	return {
		...defaultInfo,
		...filteredCustomInfo,
	} as T
}
