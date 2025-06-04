// Re-export core functionality
export * from "./core/index.js"

// Re-export utilities
export { PromptBuilder } from "./utils/PromptBuilder.js"
export { ValidationHelpers, SchemaBuilders } from "./utils/ValidationHelpers.js"

// Package version
export const VERSION = "1.0.0"

// Package information
export const PACKAGE_INFO = {
	name: "@roo-code/typed-llm-stream",
	description:
		"A TypeScript library for building type-safe, composable LLM tool systems with streaming XML response parsing",
	version: VERSION,
	repository: "https://github.com/roo-code/typed-llm-stream",
	license: "MIT",
}
