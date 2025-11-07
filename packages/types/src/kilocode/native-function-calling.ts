import { z } from "zod"
import { ProviderName, ProviderSettings } from "../provider-settings.js"

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
] satisfies ProviderName[] as ProviderName[]

export function getActiveToolUseStyle(_settings: ProviderSettings | undefined): ToolUseStyle {
	return "json"
}
