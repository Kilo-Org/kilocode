import { BaseLLMTool, LLMToolContext } from "@roo-code/typed-llm-stream"
import { z } from "zod"
import { SchemaUtils } from "./SchemaUtils"

/**
 * Tool for generating cursor jump predictions
 * This tool suggests locations where the cursor might want to jump next
 */
export class CursorJumpTool extends BaseLLMTool {
	constructor() {
		super({
			id: "cursor-jump",
			name: "Cursor Jump Predictions",
			description: "Suggests locations where the cursor might want to jump next",
			schema: z.array(
				z.object({
					file: z.string().describe("Relative file path"),
					line: z.number().int().min(1).describe("1-based line number"),
					column: z.number().int().min(1).describe("1-based column number"),
					confidence: z.number().min(0).max(1).describe("0-1 confidence score"),
					reason: z.string().optional().describe("Explanation for the jump suggestion"),
					preview: z.string().optional().describe("Code snippet preview"),
				}),
			),
			xmlTag: "cursor_jumps",
		})
	}

	generatePromptSection(context: LLMToolContext) {
		// Generate XML structure from schema
		const xmlStructure = SchemaUtils.generateXMLFromSchema("cursor_jumps", this.schema, false, 0)

		// Extract instructions from schema and add custom ones
		const instructions = SchemaUtils.extractInstructionsFromSchema(this.schema, this.xmlTag, [
			"Suggest locations where the developer might want to add code or fix issues",
			"Provide file paths relative to the workspace root",
			"Include line and column numbers for precise navigation",
			"Add confidence scores to indicate certainty",
			"Include clear reasons for each suggestion",
		])

		return this.buildXMLPromptSection(
			"CURSOR JUMPS - Suggest locations where the user might want to navigate next",
			xmlStructure,
			instructions,
			1, // Priority 1 (highest)
		)
	}

	async handleResponse(data: z.infer<typeof this.schema>, context: LLMToolContext) {
		// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
		return data
	}
}

/**
 * Tool for generating predicted edit suggestions
 * This tool suggests specific code changes at particular locations
 */
export class PredictedEditTool extends BaseLLMTool {
	constructor() {
		super({
			id: "predicted-edit",
			name: "Predicted Edits",
			description: "Suggests specific code changes at particular locations",
			schema: z.array(
				z.object({
					file: z.string().describe("Relative file path"),
					startLine: z.number().int().min(1).describe("1-based start line"),
					endLine: z.number().int().min(1).describe("1-based end line"),
					startColumn: z.number().int().min(1).optional().describe("Optional start column"),
					endColumn: z.number().int().min(1).optional().describe("Optional end column"),
					editType: z.enum(["insert", "replace", "delete"]).describe("Type of edit to perform"),
					suggestedContent: z.string().describe("Suggested replacement content"),
					originalContent: z.string().optional().describe("Current content"),
					confidence: z.number().min(0).max(1).describe("0-1 confidence score"),
					reason: z.string().optional().describe("Explanation for the edit suggestion"),
				}),
			),
			xmlTag: "predicted_edits",
		})
	}

	generatePromptSection(context: LLMToolContext) {
		// Generate XML structure from schema
		const xmlStructure = SchemaUtils.generateXMLFromSchema("predicted_edits", this.schema, false, 0)

		// Extract instructions from schema and add custom ones
		const instructions = SchemaUtils.extractInstructionsFromSchema(this.schema, this.xmlTag, [
			"Suggest improvements, bug fixes, or completions to existing code",
			"Provide file paths relative to the workspace root",
			"Include line numbers for precise edits",
			"Specify the type of edit (insert, replace, delete)",
			"Include the suggested content for the edit",
			"Add confidence scores to indicate certainty",
			"Include clear reasons for each suggestion",
		])

		return this.buildXMLPromptSection(
			"PREDICTED EDITS - Suggest specific code changes",
			xmlStructure,
			instructions,
			2, // Priority 2 (medium)
		)
	}

	async handleResponse(data: z.infer<typeof this.schema>, context: LLMToolContext) {
		// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
		return data
	}
}

/**
 * Tool for suggesting related file edits
 * This tool suggests changes in files that are related to the current file
 */
export class RelatedFileTool extends BaseLLMTool {
	constructor() {
		super({
			id: "related-file",
			name: "Related File Suggestions",
			description: "Suggests changes in files that are related to the current file",
			schema: z.array(
				z.object({
					file: z.string().describe("Relative file path"),
					priority: z.number().min(0).max(1).describe("0-1 priority score"),
					reason: z.string().optional().describe("Why this file needs changes"),
					edits: z.array(
						z.object({
							file: z.string().describe("Relative file path"),
							startLine: z.number().int().min(1).describe("1-based start line"),
							endLine: z.number().int().min(1).describe("1-based end line"),
							startColumn: z.number().int().min(1).optional().describe("Optional start column"),
							endColumn: z.number().int().min(1).optional().describe("Optional end column"),
							editType: z.enum(["insert", "replace", "delete"]).describe("Type of edit to perform"),
							suggestedContent: z.string().describe("Suggested replacement content"),
							originalContent: z.string().optional().describe("Current content"),
							confidence: z.number().min(0).max(1).describe("0-1 confidence score"),
							reason: z.string().optional().describe("Explanation for the edit suggestion"),
						}),
					),
				}),
			),
			xmlTag: "related_files",
		})
	}

	generatePromptSection(context: LLMToolContext) {
		// Generate XML structure from schema
		const xmlStructure = SchemaUtils.generateXMLFromSchema("related_files", this.schema, false, 0)

		// Extract instructions from schema and add custom ones
		const instructions = SchemaUtils.extractInstructionsFromSchema(this.schema, this.xmlTag, [
			"Suggest changes to files that are related to the current file",
			"Provide file paths relative to the workspace root",
			"Include priority scores to indicate importance",
			"Include clear reasons for why each file needs changes",
			"Specify detailed edits for each file",
		])

		return this.buildXMLPromptSection(
			"RELATED FILE EDITS - Suggest changes in other files",
			xmlStructure,
			instructions,
			3, // Priority 3 (lowest)
		)
	}

	async handleResponse(data: z.infer<typeof this.schema>, context: LLMToolContext) {
		// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
		return data
	}
}
