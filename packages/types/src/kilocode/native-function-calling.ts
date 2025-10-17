import { z } from "zod"
import { getModelId, ProviderSettings } from "../provider-settings.js"

export const toolUseStyles = ["xml", "json"] as const

export const toolUseStylesSchema = z.enum(toolUseStyles)

export type ToolUseStyle = z.infer<typeof toolUseStylesSchema>

// a list of all provider slugs that have been tested to support native function calling
export const nativeFunctionCallingProviders = ["openrouter", "kilocode"]

const modelsDefaultingToNativeFunctionCalls = ["anthropic/claude-haiku-4.5"]

export function getActiveToolUseStyle(settings: ProviderSettings | undefined): ToolUseStyle {
	if (!settings || (settings.apiProvider && !nativeFunctionCallingProviders.includes(settings.apiProvider))) {
		return "xml"
	}
	if (settings.toolStyle) {
		return settings.toolStyle
	}
	const model = getModelId(settings)
	if (model && modelsDefaultingToNativeFunctionCalls.includes(model)) {
		return "json"
	}
	return "xml"
}
