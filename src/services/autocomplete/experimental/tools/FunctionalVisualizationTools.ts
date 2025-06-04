import { createTool, createFunctionalToolSystem } from "@roo-code/typed-llm-stream"
import { z } from "zod"

// Define schemas for better type safety
const cursorJumpItemSchema = z.object({
	file: z.string().describe("Relative file path"),
	line: z.number().int().min(1).describe("1-based line number"),
	column: z.number().int().min(1).describe("1-based column number"),
	confidence: z.number().min(0).max(1).describe("0-1 confidence score"),
	reason: z.string().optional().describe("Explanation for the jump suggestion"),
	preview: z.string().optional().describe("Code snippet preview"),
})

const predictedEditItemSchema = z.object({
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
})

const relatedFileEditItemSchema = z.object({
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
})

const relatedFileItemSchema = z.object({
	file: z.string().describe("Relative file path"),
	priority: z.number().min(0).max(1).describe("0-1 priority score"),
	reason: z.string().optional().describe("Why this file needs changes"),
	edits: z.array(relatedFileEditItemSchema),
})

// Define types for better type safety
type CursorJumpItem = z.infer<typeof cursorJumpItemSchema>
type CursorJumpData = CursorJumpItem[]

type PredictedEditItem = z.infer<typeof predictedEditItemSchema>
type PredictedEditData = PredictedEditItem[]

type RelatedFileItem = z.infer<typeof relatedFileItemSchema>
type RelatedFileData = RelatedFileItem[]

/**
 * Tool for generating cursor jump predictions
 * This tool suggests locations where the cursor might want to jump next
 */
export const createCursorJumpTool = () => {
	const schema = z.array(cursorJumpItemSchema)

	return createTool<typeof schema, CursorJumpData>({
		id: "cursor-jump",
		name: "Cursor Jump Predictions",
		description: "Suggests locations where the cursor might want to jump next",
		schema,
		xmlTag: "cursor_jumps",
		handler: (data, context) => {
			// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
			return data
		},
	})
}

/**
 * Tool for generating predicted edit suggestions
 * This tool suggests specific code changes at particular locations
 */
export const createPredictedEditTool = () => {
	const schema = z.array(predictedEditItemSchema)

	return createTool<typeof schema, PredictedEditData>({
		id: "predicted-edit",
		name: "Predicted Edits",
		description: "Suggests specific code changes at particular locations",
		schema,
		xmlTag: "predicted_edits",
		handler: (data, context) => {
			// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
			return data
		},
	})
}

/**
 * Tool for suggesting related file edits
 * This tool suggests changes in files that are related to the current file
 */
export const createRelatedFileTool = () => {
	const schema = z.array(relatedFileItemSchema)

	return createTool<typeof schema, RelatedFileData>({
		id: "related-file",
		name: "Related File Suggestions",
		description: "Suggests changes in files that are related to the current file",
		schema,
		xmlTag: "related_files",
		handler: (data, context) => {
			// The response handler will be implemented in the ExperimentalAutocompleteVisualizer
			return data
		},
	})
}

// Create instances of the tools for easy import
export const cursorJumpTool = createCursorJumpTool()
export const predictedEditTool = createPredictedEditTool()
export const relatedFileTool = createRelatedFileTool()

// Export a function to create a visualization tool system with all tools
export const createVisualizationToolSystem = () => {
	return createFunctionalToolSystem().addTool(cursorJumpTool).addTool(predictedEditTool).addTool(relatedFileTool)
}
