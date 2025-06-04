/**
 * Example: VSCode Integration with Functional API
 *
 * This example demonstrates how to integrate the typed-llm-stream library
 * with a VSCode extension using the functional API. It shows how to create tools
 * that interact with the VSCode API and process LLM responses in a VSCode context.
 *
 * Note: This is a conceptual example and would need to be adapted to work
 * in an actual VSCode extension with the proper imports and setup.
 */

import { createTool, createToolSystem } from "../index.js"
import { z } from "zod"

// Mock VSCode types for the example
interface VSCodeEditor {
	document: { uri: string; fileName: string; getText: () => string }
	selection: { start: { line: number; character: number }; end: { line: number; character: number } }
	edit: (callback: (editBuilder: VSCodeEditBuilder) => void) => Promise<boolean>
}

interface VSCodeEditBuilder {
	replace: (
		range: { start: { line: number; character: number }; end: { line: number; character: number } },
		text: string,
	) => void
	insert: (position: { line: number; character: number }, text: string) => void
	delete: (range: { start: { line: number; character: number }; end: { line: number; character: number } }) => void
}

// Mock VSCode API for the example
const vscode = {
	window: {
		activeTextEditor: null as VSCodeEditor | null,
		showInformationMessage: (message: string) => console.log(`[INFO] ${message}`),
		showErrorMessage: (message: string) => console.log(`[ERROR] ${message}`),
		createOutputChannel: (name: string) => ({
			appendLine: (text: string) => console.log(`[${name}] ${text}`),
			show: () => console.log(`[${name}] Output channel shown`),
		}),
	},
	workspace: {
		openTextDocument: async (uri: string) => ({ uri, getText: () => "Mock document content" }),
		applyEdit: async (edit: any) => true,
	},
}

// Define schemas with proper typing
const completionSchema = z.object({
	completion: z.string().describe("Code to insert at cursor position"),
	language: z.string().describe("Programming language"),
	indentation: z.string().optional().describe("Detected indentation style"),
	imports: z.array(z.string()).optional().describe("Additional imports that might be needed"),
})

const refactoringItemSchema = z.object({
	description: z.string().describe("Brief description of the refactoring"),
	before: z.string().describe("Code before refactoring"),
	after: z.string().describe("Code after refactoring"),
	startLine: z.number().optional().describe("Starting line number"),
	endLine: z.number().optional().describe("Ending line number"),
	confidence: z.number().min(0).max(1).optional().describe("Confidence score (0.0 to 1.0)"),
})

const refactoringSchema = z.object({
	refactorings: z.array(refactoringItemSchema).describe("List of refactoring suggestions"),
	explanation: z.string().describe("Overall explanation of the refactoring suggestions"),
})

// Define types based on schemas
type CompletionData = z.infer<typeof completionSchema>
type RefactoringData = z.infer<typeof refactoringSchema>

// Create a code completion tool
const codeCompletionTool = createTool<typeof completionSchema, CompletionData>({
	id: "code-completion",
	name: "Code Completion",
	description: "Generates code completions based on the current context",
	schema: completionSchema,
	xmlTag: "completion",
	handler: async (data: CompletionData, context: any) => {
		const editor = context?.system?.getContext?.()?.editor as VSCodeEditor | undefined

		if (!editor) {
			vscode.window.showErrorMessage("No active text editor found")
			return data
		}

		try {
			// Insert the completion at the cursor position
			await editor.edit((editBuilder) => {
				editBuilder.insert(editor.selection.start, data.completion)
			})

			// Show a notification
			vscode.window.showInformationMessage(`Inserted ${data.language} code completion`)

			// Log any suggested imports
			if (data.imports && data.imports.length > 0) {
				const outputChannel = vscode.window.createOutputChannel("Code Completion")
				outputChannel.appendLine("Suggested imports:")
				data.imports.forEach((imp) => outputChannel.appendLine(`- ${imp}`))
				outputChannel.show()
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to insert completion: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		return data
	},
})

// Create a refactoring tool
const refactoringTool = createTool<typeof refactoringSchema, RefactoringData>({
	id: "refactoring",
	name: "Code Refactoring",
	description: "Suggests code refactoring improvements",
	schema: refactoringSchema,
	xmlTag: "refactoring",
	handler: async (data: RefactoringData, context: any) => {
		const editor = context?.system?.getContext?.()?.editor as VSCodeEditor | undefined

		if (!editor) {
			vscode.window.showErrorMessage("No active text editor found")
			return data
		}

		// Create an output channel to display the refactoring suggestions
		const outputChannel = vscode.window.createOutputChannel("Refactoring Suggestions")

		outputChannel.appendLine("# Refactoring Suggestions")
		outputChannel.appendLine("")
		outputChannel.appendLine(data.explanation)
		outputChannel.appendLine("")

		data.refactorings.forEach((refactoring, index) => {
			const confidenceStr = refactoring.confidence
				? ` (Confidence: ${Math.round(refactoring.confidence * 100)}%)`
				: ""

			const locationStr = refactoring.startLine
				? ` [Lines ${refactoring.startLine}-${refactoring.endLine || refactoring.startLine}]`
				: ""

			outputChannel.appendLine(`## Suggestion ${index + 1}${locationStr}${confidenceStr}`)
			outputChannel.appendLine(refactoring.description)
			outputChannel.appendLine("")
			outputChannel.appendLine("```diff")
			outputChannel.appendLine("- " + refactoring.before.replace(/\n/g, "\n- "))
			outputChannel.appendLine("+ " + refactoring.after.replace(/\n/g, "\n+ "))
			outputChannel.appendLine("```")
			outputChannel.appendLine("")
		})

		outputChannel.show()

		return data
	},
})

/**
 * Example of how to use the tools in a VSCode extension with the functional API
 */
async function vscodeExtensionExample() {
	// Create mock editor for the example
	vscode.window.activeTextEditor = {
		document: {
			uri: "file:///example/path/file.ts",
			fileName: "file.ts",
			getText: () =>
				"function calculateTotal(items) {\n  let total = 0;\n  for (let i = 0; i < items.length; i++) {\n    total += items[i];\n  }\n  return total;\n}",
		},
		selection: {
			start: { line: 3, character: 4 },
			end: { line: 3, character: 4 },
		},
		edit: async (callback) => {
			const mockEditBuilder = {
				replace: (range: any, text: string) => console.log(`[MOCK] Replacing text at line ${range.start.line}`),
				insert: (position: any, text: string) =>
					console.log(
						`[MOCK] Inserting text at line ${position.line}: "${text.substring(0, 20)}${text.length > 20 ? "..." : ""}"`,
					),
				delete: (range: any) =>
					console.log(`[MOCK] Deleting text from line ${range.start.line} to ${range.end.line}`),
			}
			callback(mockEditBuilder)
			return true
		},
	}

	// Create the tool system with proper typing
	type ToolRegistry = {
		"code-completion": {
			tool: typeof codeCompletionTool
			schema: typeof completionSchema
			dataType: CompletionData
		}
		refactoring: {
			tool: typeof refactoringTool
			schema: typeof refactoringSchema
			dataType: RefactoringData
		}
	}

	const toolSystem = createToolSystem<ToolRegistry>([codeCompletionTool, refactoringTool])
		.onToolResponse("code-completion", (data: CompletionData) => {
			console.log(`[UI] Completion inserted: ${data.completion.substring(0, 20)}...`)
		})
		.onToolResponse("refactoring", (data: RefactoringData) => {
			console.log(`[UI] ${data.refactorings.length} refactoring suggestions displayed`)
		})

	// Set context for the tools
	const context = {
		editor: vscode.window.activeTextEditor,
		language: "typescript",
		indentationStyle: "  ", // 2 spaces
	}

	// Generate the prompt
	const prompt = toolSystem.generatePrompt({
		systemMessage: "You are a coding assistant that can provide code completions and refactoring suggestions.",
		userMessage: "Complete the code at my cursor position and suggest refactoring improvements.",
	})

	console.log("\n=== VSCODE EXTENSION PROMPT ===\n")
	console.log(prompt)

	// Example completion response
	const completionResponse = `
<completion>
  <completion>// Calculate the total price with tax
const totalWithTax = total * 1.1;</completion>
  <language>typescript</language>
  <indentation>  </indentation>
  <imports>
    <import>import { TaxRate } from './config';</import>
  </imports>
</completion>
`

	// Process the completion response
	console.log("\n=== PROCESSING COMPLETION RESPONSE ===\n")

	// Convert the string to a mock async iterable for demonstration
	async function* mockCompletionStream() {
		const chunks = completionResponse.split("\n")
		for (const chunk of chunks) {
			yield chunk + "\n"
			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
	}

	await toolSystem.processStream(mockCompletionStream(), {
		onChunk: (chunk: string) => {}, // Omitting chunk logging for brevity
		onComplete: () => console.log("Completion processing complete"),
	})

	// Example refactoring response
	const refactoringResponse = `
<refactoring>
  <refactorings>
    <refactoring>
      <description>Use Array.reduce() for cleaner summation</description>
      <before>function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i];
  }
  return total;
}</before>
      <after>function calculateTotal(items) {
  return items.reduce((total, item) => total + item, 0);
}</after>
      <startLine>1</startLine>
      <endLine>6</endLine>
      <confidence>0.95</confidence>
    </refactoring>
    <refactoring>
      <description>Add TypeScript type annotations</description>
      <before>function calculateTotal(items) {</before>
      <after>function calculateTotal(items: number[]): number {</after>
      <startLine>1</startLine>
      <endLine>1</endLine>
      <confidence>0.9</confidence>
    </refactoring>
  </refactorings>
  <explanation>The code can be improved by using more modern JavaScript/TypeScript patterns. Array.reduce() provides a more concise way to sum array elements, and adding type annotations improves type safety and code readability.</explanation>
</refactoring>
`

	// Process the refactoring response
	console.log("\n=== PROCESSING REFACTORING RESPONSE ===\n")

	// Convert the string to a mock async iterable for demonstration
	async function* mockRefactoringStream() {
		const chunks = refactoringResponse.split("\n")
		for (const chunk of chunks) {
			yield chunk + "\n"
			// Simulate network delay
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
	}

	await toolSystem.processStream(mockRefactoringStream(), {
		onChunk: (chunk: string) => {}, // Omitting chunk logging for brevity
		onComplete: () => console.log("Refactoring processing complete"),
	})

	// Get the final results
	const results = toolSystem.getResults()
	console.log("\n=== FINAL RESULTS ===\n")
	console.log("Code Completion Result:", results["code-completion"] ? "✓" : "✗")
	console.log("Refactoring Result:", results["refactoring"] ? "✓" : "✗")
}

// For direct execution:
// For ES modules, we can check if this is the main module
import { fileURLToPath } from "url"
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
	vscodeExtensionExample().catch(console.error)
}

export { codeCompletionTool, refactoringTool, vscodeExtensionExample }
