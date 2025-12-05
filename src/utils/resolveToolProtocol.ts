import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"
import { ProviderName, getModelId } from "@roo-code/types" // kilocode_change

// kilocode_change start
export const modelsDefaultingToNativeKeywords = [
	"claude-haiku-4.5",
	"claude-haiku-4-5",
	"gpt-5-codex",
	"gpt-5.1-codex",
	"minimax-m2",
]

export const providersDefaultingToNativeKeywords = ["synthetic", "inception"]
// kilocode_change end

/**
 * Resolve the effective tool protocol based on the precedence hierarchy:
 *
 * 1. User Preference - Per-Profile (explicit profile setting)
 * 2. Model Default (defaultToolProtocol in ModelInfo)
 * 3. XML Fallback (final fallback)
 *
 * Then check support: if protocol is "native" but model doesn't support it, use XML.
 *
 * @param providerSettings - The provider settings for the current profile
 * @param modelInfo - Optional model information containing capabilities
 * @returns The resolved tool protocol (either "xml" or "native")
 */
export function resolveToolProtocol(providerSettings: ProviderSettings, modelInfo?: ModelInfo): ToolProtocol {
	// If model doesn't support native tools, return XML immediately
	// Treat undefined as unsupported (only allow native when explicitly true)
	if (modelInfo?.supportsNativeTools !== true) {
		return TOOL_PROTOCOL.XML
	}

	// 1. User Preference - Per-Profile (explicit profile setting, highest priority)
	if (providerSettings.toolProtocol) {
		return providerSettings.toolProtocol
	}

	// 2. Model Default - model's preferred protocol
	if (modelInfo?.defaultToolProtocol) {
		return modelInfo.defaultToolProtocol
	}

	// kilocode_change start: return native for specified models
	const model = getModelId(providerSettings)?.toLowerCase()
	if (!model) {
		console.error("getActiveToolUseStyle: model missing, returning xml")
		return TOOL_PROTOCOL.XML
	}

	if (
		providersDefaultingToNativeKeywords.includes(providerSettings.apiProvider as ProviderName) ||
		modelsDefaultingToNativeKeywords.some((keyword) => model.includes(keyword))
	) {
		return TOOL_PROTOCOL.NATIVE
	}
	// kilocode_change end

	// 3. XML Fallback
	return TOOL_PROTOCOL.XML
}
