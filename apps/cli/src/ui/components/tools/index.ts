/**
 * Tool renderer components for CLI TUI
 *
 * Each tool type has a specialized renderer that optimizes the display
 * of its unique data structure.
 */

import type React from "react"

import type { ToolRendererProps } from "./types.js"
import { getToolCategory } from "./types.js"

// Import all renderers
import { FileReadTool } from "./FileReadTool.js"
import { FileWriteTool } from "./FileWriteTool.js"
import { SearchTool } from "./SearchTool.js"
import { CommandTool } from "./CommandTool.js"
import { BrowserTool } from "./BrowserTool.js"
import { ModeTool } from "./ModeTool.js"
import { CompletionTool } from "./CompletionTool.js"
import { GenericTool } from "./GenericTool.js"

// Re-export types
export type { ToolRendererProps } from "./types.js"
export { getToolCategory } from "./types.js"

// Re-export utilities
export * from "./utils.js"

// Re-export individual components for direct usage
export { FileReadTool } from "./FileReadTool.js"
export { FileWriteTool } from "./FileWriteTool.js"
export { SearchTool } from "./SearchTool.js"
export { CommandTool } from "./CommandTool.js"
export { BrowserTool } from "./BrowserTool.js"
export { ModeTool } from "./ModeTool.js"
export { CompletionTool } from "./CompletionTool.js"
export { GenericTool } from "./GenericTool.js"

/**
 * Map of tool categories to their renderer components
 */
const CATEGORY_RENDERERS: Record<string, React.FC<ToolRendererProps>> = {
	"file-read": FileReadTool,
	"file-write": FileWriteTool,
	search: SearchTool,
	command: CommandTool,
	browser: BrowserTool,
	mode: ModeTool,
	completion: CompletionTool,
	other: GenericTool,
}

/**
 * Get the appropriate renderer component for a tool
 *
 * @param toolName - The tool name/identifier
 * @returns The renderer component for this tool type
 */
export function getToolRenderer(toolName: string): React.FC<ToolRendererProps> {
	const category = getToolCategory(toolName)
	return CATEGORY_RENDERERS[category] || GenericTool
}
