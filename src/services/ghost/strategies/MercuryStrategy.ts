import * as vscode from "vscode"
import { GhostSuggestionContext } from "../types"
import { StreamingParseResult } from "../GhostStreamingParser"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { PromptStrategy, UseCaseType } from "../types/PromptStrategy"
import { collectUnifiedMercuryContext } from "../snippets/collector"
import { createSuggestionsFromCompletion } from "../utils/diffToOperations"
import {
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_OPEN,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_CLOSE,
	MERCURY_CURRENT_FILE_CONTENT_OPEN,
	MERCURY_CURRENT_FILE_CONTENT_CLOSE,
	MERCURY_CODE_TO_EDIT_OPEN,
	MERCURY_CODE_TO_EDIT_CLOSE,
	MERCURY_EDIT_DIFF_HISTORY_OPEN,
	MERCURY_EDIT_DIFF_HISTORY_CLOSE,
	MERCURY_CURSOR,
} from "../utils/ghostSuggestionConstants"
import { EditableRegionCalculator, EditableRegionResult } from "./mercury/EditableRegionCalculator"
import { GhostContextError, GhostStrategyError } from "../errors/GhostErrors"

// Constants
const MAX_EDITABLE_REGION_TOKENS = 512

/**
 * Mercury Prompt Strategy - SIMPLIFIED AND CORRECT
 *
 * HOW IT WORKS:
 * 1. Calculate editable region once, store content + positions
 * 2. Send editable region content in prompt
 * 3. Get response with modified editable region
 * 4. Use myersDiff to diff original vs response editable region
 * 5. Convert diff to operations using FIXED fromDiffLines logic
 *
 */
export class MercuryStrategy implements PromptStrategy {
	public readonly name: string = "Mercury Coder"
	public readonly type: UseCaseType = UseCaseType.MERCURY_CODER

	private context: GhostSuggestionContext | null = null
	private accumulatedResponse: string = ""
	private editableRegion: EditableRegionResult | null = null // Store once, reuse everywhere
	private editableRegionCalculator = new EditableRegionCalculator()

	/**
	 * Mercury Strategy handles ALL completion scenarios when Mercury model is available
	 */
	canHandle(context: GhostSuggestionContext): boolean {
		return context.document !== undefined && context.range !== undefined
	}

	/**
	 * Get relevant context for Mercury analysis
	 */
	getRelevantContext(context: GhostSuggestionContext): Partial<GhostSuggestionContext> {
		return {
			document: context.document,
			range: context.range,
			diagnostics: context.diagnostics,
			documentAST: context.documentAST,
			rangeASTNode: context.rangeASTNode,
			recentOperations: context.recentOperations,
			openFiles: context.openFiles,
			mercuryRecentlyViewedSnippets: context.mercuryRecentlyViewedSnippets,
			mercuryEditHistory: context.mercuryEditHistory,
		}
	}

	/**
	 * Generate system instructions for the AI model
	 */
	getSystemInstructions(customInstructions?: string): string {
		const baseInstructions = `You are Mercury, an AI coding assistant by Inception Labs. Complete code within ${MERCURY_CODE_TO_EDIT_OPEN} tags based on developer context.

# Context Available
- recently_viewed_code_snippets: Recent code the developer viewed (oldest to newest)
- current_file_content: Full file context for reference
- edit_diff_history: Recent changes (oldest to latest, may be irrelevant)
- ${MERCURY_CURSOR}: Current cursor position

# Task
Predict and complete the developer's next changes in ${MERCURY_CODE_TO_EDIT_OPEN}. Continue their current path - implementing features, improving code quality, or fixing issues. Only suggest changes you're confident about.

# Output Rules
- Return ONLY revised code between ${MERCURY_CODE_TO_EDIT_OPEN} and ${MERCURY_CODE_TO_EDIT_CLOSE} tags
- If no changes needed, return original code unchanged
- NEVER duplicate code outside the tags
- Avoid reverting developer's last change unless obvious errors exist`

		if (customInstructions) {
			return `${baseInstructions}\n\n${customInstructions}`
		}
		return baseInstructions
	}

	/**
	 * Build Mercury Coder prompt using unified context collection
	 */
	async getUserPrompt(context: GhostSuggestionContext): Promise<string> {
		if (!context.document) {
			throw new GhostContextError("Document is required for Mercury Coder analysis", "document")
		}
		if (!context.range) {
			throw new GhostContextError("Range is required for Mercury Coder analysis", "range")
		}

		try {
			// Collect unified context
			const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			const unifiedContext = await collectUnifiedMercuryContext(context.document, context.range, workspaceDir)

			// Build prompt blocks
			const recentlyViewedSnippets = unifiedContext.recentlyViewedSnippets.map((snippet) => snippet.content)
			const recentlyViewedBlock = this.buildRecentlyViewedCodeSnippetsBlock(recentlyViewedSnippets)
			const currentFileBlock = this.buildCurrentFileContentBlock(context)
			const editHistoryBlock = this.buildEditHistoryBlock(unifiedContext.editHistory)

			return `${recentlyViewedBlock}${currentFileBlock}${editHistoryBlock}`
		} catch (error) {
			throw new GhostStrategyError(
				`Failed to generate Mercury prompt: ${error instanceof Error ? error.message : String(error)}`,
				this.name,
				"prompt_generation",
			)
		}
	}

	/**
	 * Initialize processing - calculate and store the editable region ONCE
	 */
	initializeProcessing(context: GhostSuggestionContext): void {
		this.reset()
		this.context = context
		this.accumulatedResponse = ""

		// CRITICAL: Calculate editable region once and store it
		if (context.document && context.range) {
			this.editableRegion = this.editableRegionCalculator.calculateEditableRegionContent(
				context.document,
				context.range,
				MAX_EDITABLE_REGION_TOKENS,
			)
			console.log("Mercury stored editable region:", {
				content: JSON.stringify(this.editableRegion.content),
				startLine: this.editableRegion.startLine,
				endLine: this.editableRegion.endLine,
				tokensUsed: this.editableRegion.tokensUsed,
			})
		}
	}

	/**
	 * Process response chunk - Mercury uses simple extraction, no streaming needed
	 */
	processResponseChunk(chunk: string): StreamingParseResult {
		this.accumulatedResponse += chunk
		return this.createEmptyResult()
	}

	/**
	 * Finish processing and extract Mercury completion
	 */
	finishProcessing(): StreamingParseResult {
		if (!this.context || !this.accumulatedResponse.trim() || !this.editableRegion) {
			return this.createEmptyResult()
		}

		try {
			// Extract the response editable region from Mercury response
			const responseEditableRegion = this.extractCompletion(this.accumulatedResponse)
			if (!responseEditableRegion) {
				return this.createEmptyResult()
			}

			console.log("Mercury response content:", JSON.stringify(responseEditableRegion))

			// CORE LOGIC: Use myersDiff to diff original vs response editable regions
			const suggestions = this.generateSuggestionsFromMyersDiff(
				this.editableRegion.content,
				responseEditableRegion,
				this.context,
			)

			return this.createCompleteResult(suggestions)
		} catch (error) {
			console.error("Error in Mercury finishProcessing:", error)
			return this.createEmptyResult()
		}
	}

	/**
	 * Reset parser state
	 */
	reset(): void {
		this.context = null
		this.accumulatedResponse = ""
		this.editableRegion = null
	}

	/**
	 * Extract completion from Mercury response
	 */
	extractCompletion(response: string): string {
		const codeMatch = response.match(
			new RegExp(
				`${MERCURY_CODE_TO_EDIT_OPEN.replace(/[|]/g, "\\|")}([\\s\\S]*?)${MERCURY_CODE_TO_EDIT_CLOSE.replace(/[|]/g, "\\|")}`,
				"i",
			),
		)
		if (codeMatch) {
			return codeMatch[1].trim()
		}
		return ""
	}

	/**
	 * Strip Mercury markers from response content
	 */
	stripMercuryMarkers(content: string): string {
		return content
			.replace(new RegExp(MERCURY_CODE_TO_EDIT_OPEN.replace(/[|]/g, "\\|"), "g"), "")
			.replace(new RegExp(MERCURY_CODE_TO_EDIT_CLOSE.replace(/[|]/g, "\\|"), "g"), "")
			.trim()
	}

	/**
	 * Generate suggestions using myersDiff and FIXED diff-to-operations conversion
	 */
	private generateSuggestionsFromMyersDiff(
		originalEditableRegion: string,
		responseEditableRegion: string,
		context: GhostSuggestionContext,
	): GhostSuggestionsState {
		try {
			// If content is identical, no suggestions needed
			if (originalEditableRegion.trim() === responseEditableRegion.trim()) {
				console.log("Content is identical, no suggestions needed")
				return new GhostSuggestionsState()
			}

			console.log("Using consolidated createSuggestionsFromCompletion utility")

			// Use the consolidated utility that works for all strategies
			const targetLines = {
				startLine: this.editableRegion!.startLine,
				endLine: this.editableRegion!.endLine,
			}

			const suggestions = createSuggestionsFromCompletion(responseEditableRegion, context, targetLines)

			console.log("Generated suggestions using consolidated utility")

			return suggestions
		} catch (error) {
			console.error("Error generating suggestions:", error)
			return new GhostSuggestionsState()
		}
	}

	// === HELPER METHODS ===

	private createEmptyResult(): StreamingParseResult {
		return {
			suggestions: new GhostSuggestionsState(),
			isComplete: false,
			hasNewSuggestions: false,
		}
	}

	private createCompleteResult(suggestions: GhostSuggestionsState): StreamingParseResult {
		return {
			suggestions,
			isComplete: true,
			hasNewSuggestions: suggestions.hasSuggestions(),
		}
	}

	/**
	 * Build recently viewed code snippets block
	 */
	private buildRecentlyViewedCodeSnippetsBlock(snippets: string[]): string {
		if (snippets.length === 0) {
			return ""
		}

		const snippetBlocks = snippets
			.map(
				(snippet) =>
					`${MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_OPEN}\n${snippet}\n${MERCURY_RECENTLY_VIEWED_CODE_SNIPPET_CLOSE}`,
			)
			.join("\n\n")

		return `${MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN}\n${snippetBlocks}\n${MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE}\n\n`
	}

	/**
	 * Build current file content block with editable region
	 */
	private buildCurrentFileContentBlock(context: GhostSuggestionContext): string {
		if (!context.document || !this.editableRegion) {
			return ""
		}

		const document = context.document
		const lines = document.getText().split("\n")

		// Add line numbers for reference (these help Mercury understand context)
		const numberedLines = lines.map((line, index) => {
			const lineNumber = index + 1
			const isActive = context.range && index >= context.range.start.line && index <= context.range.end.line
			if (isActive && line.trim() === "") {
				return `${lineNumber}| ${MERCURY_CURSOR}`
			}
			return `${lineNumber}| ${line}`
		})

		const numberedContent = numberedLines.join("\n")

		// Use the stored editable region content
		const editableContent = this.editableRegion.content

		return `${MERCURY_CURRENT_FILE_CONTENT_OPEN}\n${numberedContent}\n${MERCURY_CURRENT_FILE_CONTENT_CLOSE}\n\n${MERCURY_CODE_TO_EDIT_OPEN}\n${editableContent}\n${MERCURY_CODE_TO_EDIT_CLOSE}\n\n`
	}

	/**
	 * Build edit history block
	 */
	private buildEditHistoryBlock(editHistory: string[]): string {
		if (editHistory.length === 0) {
			return ""
		}

		const historyContent = editHistory.join("\n\n")
		return `${MERCURY_EDIT_DIFF_HISTORY_OPEN}\n${historyContent}\n${MERCURY_EDIT_DIFF_HISTORY_CLOSE}\n\n`
	}
}
