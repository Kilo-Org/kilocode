// Export functional API
export { createTool, createToolSystem, createXMLParser, createBasicPromptTemplate } from "./functional.js"

// Export types
export type {
	Tool,
	ToolSystem,
	ToolConfig,
	ToolRegistry,
	XMLParser,
	LLMToolContext,
	LLMPromptSection,
	LLMToolResult,
	LLMPromptTemplate,
} from "./functional-types.js"

// Package version
export const VERSION = "1.0.0"
