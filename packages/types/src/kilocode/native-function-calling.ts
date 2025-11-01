import { z } from "zod"
import { getModelId, ProviderName, ProviderSettings } from "../provider-settings.js"

export const toolUseStyles = ["xml", "json"] as const

export const toolUseStylesSchema = z.enum(toolUseStyles)

export type ToolUseStyle = z.infer<typeof toolUseStylesSchema>

// a list of all provider slugs that have been tested to support native function calling
export const nativeFunctionCallingProviders = [
	"openrouter",
	"kilocode",
	"openai",
	"lmstudio",
	"chutes",
	"deepinfra",
	"xai",
	"zai",
	"synthetic",
	"human-relay",
	"inception",
] satisfies ProviderName[] as ProviderName[]

const modelsDefaultingToJsonKeywords = ["claude-haiku-4.5", "claude-haiku-4-5"]

export function getActiveToolUseStyle(settings: ProviderSettings | undefined): ToolUseStyle {
	if (
		!settings ||
		(settings.apiProvider && !nativeFunctionCallingProviders.includes(settings.apiProvider as ProviderName))
	) {
		return "xml"
	}
	if (settings.toolStyle) {
		return settings.toolStyle
	}
	const model = getModelId(settings)?.toLowerCase()
	if (model && modelsDefaultingToJsonKeywords.some((keyword) => model.includes(keyword))) {
		return "json"
	}
	return "xml"
}
