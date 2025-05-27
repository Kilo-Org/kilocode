import { ToolHandler } from "./types.js"
import { i18nTools } from "./i18n/index.js"

const allTools: ToolHandler[] = [...i18nTools]

export function getAllTools(): ToolHandler[] {
	return allTools
}

export function getToolByName(name: string): ToolHandler | undefined {
	return allTools.find((tool) => tool.name === name)
}

export { i18nTools }
