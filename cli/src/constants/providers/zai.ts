/**
 * ZAI Provider Constants for CLI Authentication
 *
 * This file contains constants and configurations for the ZAI provider
 * used specifically in the CLI authentication wizard.
 */

import type { ZaiApiLine } from "@roo-code/types"

/**
 * Available ZAI API lines with descriptions for CLI selection
 */
export const ZAI_API_LINES = [
	{
		value: "international_coding" as ZaiApiLine,
		name: "International Coding Plan",
		description: "International API endpoint optimized for coding tasks",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
	},
	{
		value: "china_coding" as ZaiApiLine,
		name: "China Coding Plan",
		description: "China API endpoint optimized for coding tasks",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
	},
] as const

/**
 * Available ZAI models with descriptions for CLI selection
 * These are the models available across both international and China API lines
 */
export const ZAI_MODELS = [
	{
		value: "glm-4.6",
		name: "GLM-4.6",
		description: "Zhipu's newest model with extended context window (up to 200k tokens)",
		contextWindow: 204800,
	},
	{
		value: "glm-4.5",
		name: "GLM-4.5",
		description: "Zhipu's previous flagship model",
		contextWindow: 131072,
	},
	{
		value: "glm-4.5-air",
		name: "GLM-4.5-Air",
		description: "Lightweight version balancing performance and cost-effectiveness",
		contextWindow: 131072,
	},
	{
		value: "glm-4.5-flash",
		name: "GLM-4.5-Flash",
		description: "Most advanced free model to date",
		contextWindow: 131072,
	},
] as const

/**
 * Default values for ZAI provider configuration
 */
export const ZAI_DEFAULTS = {
	apiLine: "international_coding" as ZaiApiLine,
	model: "glm-4.6",
} as const

/**
 * Helper function to get API line info by value
 */
export function getZaiApiLineInfo(apiLine: ZaiApiLine) {
	return ZAI_API_LINES.find((line) => line.value === apiLine)
}

/**
 * Helper function to get model info by value
 */
export function getZaiModelInfo(modelValue: string) {
	return ZAI_MODELS.find((model) => model.value === modelValue)
}

/**
 * Format model choices for inquirer
 */
export function formatZaiModelChoices() {
	return ZAI_MODELS.map((model) => ({
		name: `${model.name} - ${model.description} (${model.contextWindow.toLocaleString()} tokens)`,
		value: model.value,
		short: model.name,
	}))
}

/**
 * Format API line choices for inquirer
 */
export function formatZaiApiLineChoices() {
	return ZAI_API_LINES.map((line) => ({
		name: `${line.name} - ${line.description}`,
		value: line.value,
		short: line.name,
	}))
}
