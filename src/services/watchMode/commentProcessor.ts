import * as vscode from "vscode"
import {
	AICommentData,
	CommentProcessingResult,
	CommentProcessorOptions,
	DiffBlock,
	DiffEdit as NewDiffEdit,
	AIResponse,
	TriggerType,
} from "./types"
import { MultiSearchReplaceDiffStrategy } from "../../core/diff/strategies/multi-search-replace"
import { hunkToBeforeAfter, processDiffBlock } from "./unifiedDiffStrategy"

/**
 * Interface for a diff edit
 */
export interface DiffEdit {
	path: string
	hunk: string[]
}
/**
 * Custom error for when search text is not unique in a file
 */
export class SearchTextNotUnique extends Error {
	constructor(message: string) {
		super(message)
		this.name = "SearchTextNotUnique"
	}
}

// Regular expressions for detecting KILO comments
const createAICommentPatterns = (prefix: string) => [
	// For single line comments: // KO! do something (with or without space after //)
	new RegExp(`\\/\\/\\s*.*?${prefix}(.*)$`, "gm"),
	// For multi-line comments: /* KO! do something */
	new RegExp(`\\/\\*\\s*.*?${prefix}(.+?)\\*\\/`, "gms"),
	// For inline comments: /** KO! do something */
	new RegExp(`\\/\\*\\*\\s*.*?${prefix}(.+?)\\*\\/`, "gms"),
]

// Default to "KO!" if no prefix is provided
let AI_COMMENT_PATTERNS = createAICommentPatterns("KO!")

/**
 * Updates the AI comment patterns with a new prefix
 * @param prefix The prefix to use for AI comments (e.g., "KO!")
 */
export const updateAICommentPatterns = (prefix: string): void => {
	AI_COMMENT_PATTERNS = createAICommentPatterns(prefix)
}

// Regular expression for detecting code blocks in AI responses
const CODE_BLOCK_REGEX = /```(?:[\w-]*)\n([\s\S]*?)```/g

// Regular expression for parsing unified diffs in legacy code
// This is now handled differently in the new implementation

/**
 * Interface for a diff edit
 */
export interface DiffEdit {
	path: string
	hunk: string[]
}
/**
 * Extracts code context around the given position
 * @param content Full file content
 * @param position Position in the document
 * @param contextLines Number of context lines to extract before and after
 */
const extractCodeContext = (
	content: string,
	startPos: vscode.Position,
	endPos: vscode.Position,
	contextLines: number = 5,
): string => {
	const lines = content.split("\n")
	const startLine = typeof startPos.line === "number" ? Math.max(0, startPos.line - contextLines) : 0
	const endLine =
		typeof endPos.line === "number" ? Math.min(lines.length - 1, endPos.line + contextLines) : lines.length - 1

	const extractedContext = lines.slice(startLine, endLine + 1).join("\n")
	// console.log(`Extracted context: ${extractedContext.substring(0, 100)}${extractedContext.length > 100 ? "..." : ""}`)

	return extractedContext
}

/**
 * Detects AI comments in the provided file content
 * @param options Comment processor options
 */
export const detectAIComments = (options: CommentProcessorOptions): CommentProcessingResult => {
	const { fileUri, content } = options
	const comments: AICommentData[] = []
	const errors: Error[] = []

	AI_COMMENT_PATTERNS.forEach((pattern) => {
		let match

		while ((match = pattern.exec(content)) !== null) {
			// Get the full matched comment and the content capture group
			const fullMatch = match[0]
			const commentContent = match[1].trim()

			// Calculate the start and end positions in the document
			const beforeMatch = content.substring(0, match.index)
			const matchLines = beforeMatch.split("\n")
			const startLine = matchLines.length - 1
			const startChar = matchLines[startLine].length

			const matchEndIndex = match.index + fullMatch.length
			const beforeEnd = content.substring(0, matchEndIndex)
			const endLines = beforeEnd.split("\n")
			const endLine = endLines.length - 1
			const endChar = endLines[endLine].length

			// Create position objects using vscode.Position
			const startPos = new vscode.Position(startLine, startChar)
			const endPos = new vscode.Position(endLine, endChar)

			// Extract surrounding code context
			// Use a larger context to ensure we capture the function definition
			const codeContext = extractCodeContext(content, startPos, endPos, 15)

			comments.push({
				content: commentContent,
				startPos,
				endPos,
				context: codeContext,
				fileUri,
			})
		}
	})
	return { comments, errors: errors.length > 0 ? errors : undefined }
}

/**
 * Builds a prompt for the AI model based on the comment and its context
 * @param commentData The AI comment data
 */
// Keep track of the current AI comment prefix for use in prompts
let currentAICommentPrefix = "KO!"

/**
 * Updates the current AI comment prefix used in prompts
 * @param prefix The new prefix to use
 */
export const updateCurrentAICommentPrefix = (prefix: string): void => {
	currentAICommentPrefix = prefix
}

/**
 * Determines the trigger type based on the comment content
 * @param commentContent The content of the AI comment
 * @returns The trigger type (Edit or Ask)
 */
export const determineTriggerType = (commentContent: string): TriggerType => {
	// Check if the comment starts with a question mark or contains a question
	if (commentContent.trim().startsWith("?") || commentContent.includes("ai?")) {
		return TriggerType.Ask
	}

	// Default to Edit mode
	return TriggerType.Edit
}

export const buildAIPrompt = (
	commentData: AICommentData,
	triggerType: TriggerType = TriggerType.Edit,
	activeFiles: { uri: vscode.Uri; content: string }[] = [],
): string => {
	const { content, context, fileUri } = commentData
	const filePath = vscode.workspace.asRelativePath(fileUri)

	// Extract the prefix without the exclamation mark for display in the prompt
	const displayPrefix = currentAICommentPrefix.endsWith("!")
		? currentAICommentPrefix.slice(0, -1)
		: currentAICommentPrefix

	// Base prompt that's common to both edit and question modes
	let prompt = `
You are Kilo Code, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

# Task

${content}

I've written your instructions in comments in the code and marked them with "${displayPrefix}"
You can see the "${displayPrefix}" comments shown below in the file ${filePath}.

# Current file content

File: ${filePath}
\`\`\`
${context || "// File appears to be empty or only contains the comment"}
\`\`\`

The above shows the current content of ${filePath} where the "${displayPrefix}" comment is located.
You need to modify this file according to the instructions in the comment.
`

	// Add content from active files for additional context
	if (activeFiles.length > 0) {
		prompt += `\n\n# Additional context from open files\n\n`

		for (const file of activeFiles) {
			// For tests, compare paths instead of full URIs
			const filePath = file.uri.path || file.uri.toString()
			const commentPath = fileUri.path || fileUri.toString()

			if (filePath !== commentPath) {
				// Skip the file with the comment
				const relativePath = vscode.workspace.asRelativePath(file.uri)
				prompt += `## File: ${relativePath}\n\n\`\`\`\n${file.content}\n\`\`\`\n\n`
			}
		}
	}

	// Add mode-specific instructions
	if (triggerType === TriggerType.Edit) {
		prompt += `
# Response format

You MUST respond with SEARCH/REPLACE blocks for each edit. Format your changes as follows:

${filePath}
<<<<<<< SEARCH
exact original code
=======
replacement code
>>>>>>> REPLACE

IMPORTANT: You MUST ALWAYS include the file path (${filePath}) before each SEARCH/REPLACE block.
You can include multiple SEARCH/REPLACE blocks for the same file, and you can edit multiple files.
Make sure to include enough context in the SEARCH block to uniquely identify the code to replace.
After completing the instructions, also BE SURE to remove all the "${displayPrefix}" comments from the code.

You can also provide unified diff format if that's more appropriate for your changes:
\`\`\`diff
--- ${filePath}
+++ ${filePath}
@@ ... @@
 // Context line(s) before (unchanged, starts with space)
-// Old line to be removed or changed (starts with -)
+// New line to replace it (starts with +)
 // Context line(s) after (unchanged, starts with space)
\`\`\`

NEVER use generic file names like "Code", "file", or similar placeholders. ALWAYS use the actual file path: ${filePath}

If you need to explain your changes, please do so before or after the code blocks.
`
	} else {
		// Question mode
		prompt += `
# Response format

Since this appears to be a question rather than a code edit request, please provide a detailed analysis or explanation.
You don't need to modify any code - just answer the question thoroughly based on the code context provided.

If you do need to suggest code changes, you can include them as examples in your explanation using markdown code blocks.
`
	}

	const finalPrompt = prompt.trim()

	// Debug log the full prompt string
	console.log("🧶🧶🧶[WatchMode DEBUG] === FULL AI PROMPT ===\n" + finalPrompt)

	return finalPrompt
}

/**
 * Estimates the token count of a string
 * This is a very rough estimate - about 4 characters per token
 * @param text The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4)
}

/**
 * Parses SEARCH/REPLACE blocks from the AI response
 * @param response The AI response containing SEARCH/REPLACE blocks
 * @returns An array of NewDiffEdit objects
 */
export function parseSearchReplaceBlocks(response: string, defaultFilePath?: string): NewDiffEdit[] {
	const edits: NewDiffEdit[] = []

	// Simple regex to match SEARCH/REPLACE blocks with file path
	const fileBlockRegex = /([^\s]+?)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g

	// Process matches
	let match
	while ((match = fileBlockRegex.exec(response)) !== null) {
		const filePath = defaultFilePath || match[1].trim()
		const searchBlock = match[2]
		const replaceBlock = match[3]

		// Create a DiffEdit with DiffBlocks
		const blocks: DiffBlock[] = [
			{ type: "SEARCH", content: searchBlock },
			{ type: "REPLACE", content: replaceBlock },
		]

		edits.push({
			filePath,
			blocks,
		})
	}

	return edits
}

/**
 * Parses the AI response to extract edits in either SEARCH/REPLACE or unified diff format
 * @param response The AI response
 * @param triggerType The trigger type (Edit or Ask)
 * @returns An AIResponse object containing the edits and explanation
 */
export function parseAIResponse(response: string, triggerType: TriggerType, currentFilePath?: string): AIResponse {
	console.log("🤖🤖🤖[WatchMode DEBUG] === FULL AI RESPONSE ===\n" + response)

	const result: AIResponse = {
		edits: [],
		explanation: "",
		triggerType,
	}

	// If it's a question, just return the response as explanation
	if (triggerType === TriggerType.Ask) {
		result.explanation = response
		return result
	}

	// Try to parse SEARCH/REPLACE blocks first
	const searchReplaceEdits = parseSearchReplaceBlocks(response, currentFilePath)
	if (searchReplaceEdits.length > 0) {
		result.edits = searchReplaceEdits

		// Extract any explanation text (text before or after the code blocks)
		const withoutCodeBlocks = response.replace(
			/([^\s]+?)\n(?:`)?<<<<<<< SEARCH(?:`)?(?:\n|\s)[\s\S]*?(?:`)?>>>>>>> REPLACE(?:`)?/g,
			"",
		)
		result.explanation = withoutCodeBlocks.trim()

		return result
	}

	// If no SEARCH/REPLACE blocks found, try unified diffs
	const unifiedDiffEdits = findDiffs(response).map((edit) => {
		// Convert from old format to new format
		const [before, after] = hunkToBeforeAfter(edit.hunk, true) as [string[], string[]]

		// Use currentFilePath if the diff path is generic or missing
		let filePath = edit.path
		if (currentFilePath && (filePath === "Code" || filePath === "file" || !filePath)) {
			filePath = currentFilePath
		}

		return {
			filePath,
			blocks: [
				{ type: "SEARCH" as const, content: (before as string[]).join("\n") },
				{ type: "REPLACE" as const, content: (after as string[]).join("\n") },
			],
		}
	})

	if (unifiedDiffEdits.length > 0) {
		result.edits = unifiedDiffEdits

		// Extract any explanation text (text before or after the code blocks)
		const withoutDiffs = response.replace(/```diff[\s\S]*?```/g, "").replace(/---[\s\S]*?(?=\n\n|$)/g, "")
		result.explanation = withoutDiffs.trim()

		return result
	}

	// If no edits found, treat the entire response as explanation
	result.explanation = response

	console.log(
		`[WatchMode DEBUG] Parsed ${result.edits.length} edits, explanation length: ${result.explanation.length}`,
	)
	return result
}

/**
 * Parses unified diffs from the AI response
 * @param response The AI response containing unified diffs
 * @returns An array of parsed diffs
 */
export function findDiffs(content: string): DiffEdit[] {
	// Ensure content ends with newline
	if (!content.endsWith("\n")) {
		content = content + "\n"
	}

	// Split by newline but don't add extra newlines to each line
	const lines = content.split("\n")
	let lineNum = 0
	const edits: DiffEdit[] = []

	// First check for code blocks with diffs
	while (lineNum < lines.length) {
		const line = lines[lineNum]
		if (
			line.startsWith("```diff") ||
			(line.startsWith("```") &&
				lineNum + 2 < lines.length &&
				lines[lineNum + 1].startsWith("---") &&
				lines[lineNum + 2].startsWith("+++"))
		) {
			const [newLineNum, theseEdits] = processFencedBlock(lines, lineNum + 1)
			edits.push(...theseEdits)
			lineNum = newLineNum
		} else {
			lineNum++
		}
	}

	// If no code blocks found, check for raw diffs in the content
	if (edits.length === 0 && content.includes("---") && content.includes("+++")) {
		// Try to extract diffs directly from the content
		const contentLines = content.split("\n")
		let diffContent = ""
		let inDiff = false

		for (const line of contentLines) {
			if (line.startsWith("---")) {
				inDiff = true
				diffContent = line + "\n"
			} else if (inDiff) {
				diffContent += line + "\n"
				if (line.trim() === "" && diffContent.includes("+++") && diffContent.includes("@@")) {
					// Process this diff block
					const dummyLines = diffContent.split("\n")
					const [_, theseEdits] = processDiffBlock(dummyLines, 0)
					edits.push(...theseEdits)
					inDiff = false
					diffContent = ""
				}
			}
		}

		// Add the last diff if there is one
		if (inDiff && diffContent.includes("+++") && diffContent.includes("@@")) {
			const dummyLines = diffContent.split("\n")
			const [_, theseEdits] = processDiffBlock(dummyLines, 0)
			edits.push(...theseEdits)
		}
	}

	return edits
}

/**
 * Processes a fenced code block to extract diffs
 */
export function processFencedBlock(lines: string[], startLineNum: number): [number, DiffEdit[]] {
	let lineNum = startLineNum
	// Find the end of the code block
	for (; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum]
		if (line.startsWith("```")) {
			break
		}
	}

	// Extract the content inside the code block
	const block = lines.slice(startLineNum, lineNum)

	// Process the block content
	const [_, edits] = processDiffBlock(block, 0)

	// Return the updated line number and edits
	return [lineNum + 1, edits]
}

/**
 * Applies SEARCH/REPLACE blocks to a document using MultiSearchReplaceDiffStrategy
 * @param document The document to modify
 * @param edits The NewDiffEdit objects containing SEARCH/REPLACE blocks
 * @returns A promise that resolves to true if the edits were applied successfully
 */
export const applySearchReplaceEdits = async (
	document: vscode.TextDocument,
	edits: NewDiffEdit[],
): Promise<boolean> => {
	try {
		const documentContent = document.getText()
		const documentUri = document.uri
		const documentPath = vscode.workspace.asRelativePath(documentUri)

		// Create a new instance of MultiSearchReplaceDiffStrategy with 100% match requirement
		const diffStrategy = new MultiSearchReplaceDiffStrategy(1.0, 40) // 100% similarity threshold, 40 buffer lines

		// Build the diff content in the format expected by MultiSearchReplaceDiffStrategy
		let diffContent = ""
		for (const edit of edits) {
			const searchBlock = edit.blocks.find((block) => block.type === "SEARCH")
			const replaceBlock = edit.blocks.find((block) => block.type === "REPLACE")

			if (!searchBlock || !replaceBlock) {
				continue
			}

			diffContent += "<<<<<<< SEARCH\n"
			diffContent += ":start_line:0\n" // Use 0 to let the strategy find the best match
			diffContent += "-------\n"
			diffContent += searchBlock.content + "\n"
			diffContent += "=======\n"
			diffContent += replaceBlock.content + "\n"
			diffContent += ">>>>>>> REPLACE\n\n"
		}

		if (diffContent === "") {
			console.log(`[WatchMode DEBUG] No valid edits found`)
			return false
		}

		// Apply the diff using MultiSearchReplaceDiffStrategy
		const result = await diffStrategy.applyDiff(documentContent, diffContent)

		if (!result.success) {
			console.error(`[WatchMode DEBUG] Failed to apply diff:`, result.error || "Unknown error")
			if (result.failParts && result.failParts.length > 0) {
				for (const part of result.failParts) {
					if (!part.success && part.error) {
						console.error("[WatchMode DEBUG] Diff part failed:", part.error)
					}
				}
			}
			return false
		}

		// Apply the changes to the document
		const edit = new vscode.WorkspaceEdit()
		const fullRange = new vscode.Range(new vscode.Position(0, 0), document.positionAt(documentContent.length))

		edit.replace(documentUri, fullRange, result.content!)
		const success = await vscode.workspace.applyEdit(edit)

		console.log(`[WatchMode DEBUG] Applied changes to ${documentPath}: ${success ? "SUCCESS" : "FAILED"}`)

		if (success) {
			// Save the file after modifying it
			try {
				await document.save()
				console.log(`[WatchMode DEBUG] Saved file ${documentPath}`)
			} catch (error) {
				console.error(`[WatchMode DEBUG] Error saving file ${documentPath}:`, error)
				return false
			}
		}

		return success
	} catch (error) {
		console.error("[WatchMode DEBUG] Error applying SEARCH/REPLACE edits:", error)
		return false
	}
}

/**
 * Processes the AI response and applies it to the document
 * @param document The document to modify
 * @param commentData The original AI comment data
 * @param response The AI response
 * @param reflectionAttempt Current reflection attempt number (for retry logic)
 * @returns A promise that resolves to true if the response was applied successfully
 */
export const processAIResponse = async (
	document: vscode.TextDocument,
	commentData: AICommentData,
	response: string,
): Promise<boolean> => {
	// Determine the trigger type from the comment content
	const triggerType = determineTriggerType(commentData.content)
	console.log(`[WatchMode DEBUG] Trigger type: ${triggerType}`)

	// Parse the AI response
	const currentFilePath = vscode.workspace.asRelativePath(document.uri)
	const parsedResponse = parseAIResponse(response, triggerType, currentFilePath)

	// If it's a question, just show the explanation
	if (triggerType === TriggerType.Ask) {
		// Show the explanation in a new editor or information message
		await vscode.window.showInformationMessage(
			"AI Response: " + parsedResponse.explanation.substring(0, 100) + "...",
		)

		// Remove the comment
		const edit = new vscode.WorkspaceEdit()
		const range = new vscode.Range(commentData.startPos, commentData.endPos)
		edit.delete(document.uri, range)
		const result = await vscode.workspace.applyEdit(edit)

		console.log(`[WatchMode DEBUG] Comment removal result: ${result ? "SUCCESS" : "FAILED"}`)
		return result
	}

	// If there are no edits but there's an explanation, show it
	if (parsedResponse.edits.length === 0 && parsedResponse.explanation) {
		console.log("[WatchMode DEBUG] No edits found, but explanation exists")

		// Check if there are code blocks in the explanation that should replace the comment
		const codeBlocks: string[] = []
		// Use the existing CODE_BLOCK_REGEX constant
		let match

		while ((match = CODE_BLOCK_REGEX.exec(parsedResponse.explanation)) !== null) {
			if (match[1]) {
				codeBlocks.push(match[1].trim())
			}
		}

		if (codeBlocks.length > 0) {
			console.log(`[WatchMode DEBUG] Found ${codeBlocks.length} code blocks, using as replacement`)

			// Use the code blocks as a direct replacement for the comment
			const edit = new vscode.WorkspaceEdit()
			const range = new vscode.Range(commentData.startPos, commentData.endPos)
			const replacement = codeBlocks.join("\n\n")

			edit.replace(document.uri, range, replacement)
			const result = await vscode.workspace.applyEdit(edit)

			console.log(`[WatchMode DEBUG] Direct replacement result: ${result ? "SUCCESS" : "FAILED"}`)
			return result
		}

		// If no code blocks were found, just remove the comment
		console.log("[WatchMode DEBUG] No code blocks found, removing comment")
		const edit = new vscode.WorkspaceEdit()
		const range = new vscode.Range(commentData.startPos, commentData.endPos)

		edit.delete(document.uri, range)
		const result = await vscode.workspace.applyEdit(edit)

		console.log(`[WatchMode DEBUG] Comment removal result: ${result ? "SUCCESS" : "FAILED"}`)
		return result
	}

	// Apply the edits based on their format
	// The parseAIResponse function already determines if it's SEARCH/REPLACE or unified diff
	let success = false

	// Check if we have any edits to apply
	if (parsedResponse.edits.length > 0) {
		console.log(`[WatchMode DEBUG] Applying ${parsedResponse.edits.length} edits`)
		success = await applySearchReplaceEdits(document, parsedResponse.edits)
	} else {
		console.log("[WatchMode DEBUG] No edits found in AI response")
	}

	console.log(`[WatchMode DEBUG] Process result: ${success ? "SUCCESS" : "FAILED"}`)

	// If the edits failed and we haven't exceeded reflection attempts, throw reflection error
	if (!success) {
		throw new Error("Failed to apply edits: " + response)
	}

	return success
}
