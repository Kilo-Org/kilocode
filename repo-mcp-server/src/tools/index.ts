/**
 * Main tools index file
 * Collects and exports all tool handlers from different categories
 */

import { ToolHandler } from "./types.js"
import { i18nTools } from "./i18n/index.js"

// Combine all tools from different categories
const allTools: ToolHandler[] = [
	...i18nTools,
	// Additional tool categories will be added here as they're developed
	// For example:
	// ...devTools,
	// ...analyticTools,
	// etc.
]

/**
 * Get all registered tool handlers
 * @returns Array of all tool handlers
 */
export function getAllTools(): ToolHandler[] {
	return allTools
}

/**
 * Get a specific tool handler by name
 * @param name Name of the tool
 * @returns Tool handler if found, undefined otherwise
 */
export function getToolByName(name: string): ToolHandler | undefined {
	return allTools.find((tool) => tool.name === name)
}

// Export all tools by category for direct access
export { i18nTools }
