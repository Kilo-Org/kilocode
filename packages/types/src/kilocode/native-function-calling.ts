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
	"qwen-code",
	"inception",
	"litellm",
	"minimax",
	"anthropic",
	"moonshot",
] satisfies ProviderName[] as ProviderName[]

const modelsDefaultingToJsonKeywords = [
	"claude-haiku-4.5",
	"claude-haiku-4-5",
	"gpt-5-codex",
	"gpt-5.1-codex",
	"minimax-m2",
]

//Specific providers that default to JSON tool use, regardless of model.
const providersDefaultingToJsonKeywords = [
	"synthetic", //All synthetic models support JSON tools, and their pricing model strongly encourages their use
	"inception",
]

export function getActiveToolUseStyle(settings: ProviderSettings | undefined): ToolUseStyle {
	if (!settings) {
		console.error("getActiveToolUseStyle: settings missing, returning xml")
		return "xml"
	}
	if (settings.apiProvider && !nativeFunctionCallingProviders.includes(settings.apiProvider as ProviderName)) {
		return "xml"
	}
	if (settings.toolStyle) {
		return settings.toolStyle
	}
	const model = getModelId(settings)?.toLowerCase()
	if (!model) {
		console.error("getActiveToolUseStyle: model missing, returning xml")
		return "xml"
	}
	if (providersDefaultingToJsonKeywords.includes(settings.apiProvider as ProviderName)) {
		return "json" //providers that always use json
	}
	return modelsDefaultingToJsonKeywords.some((keyword) => model.includes(keyword)) ? "json" : "xml"
}
