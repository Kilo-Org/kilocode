import * as vscode from "vscode"
import { EditorContextSnapshot } from "./EditorContextSnapshot"
import {
	countTokens,
	getPrunedPrefixSuffix,
	ContextExpansionOptions,
	calculateOptimalEditableRegion,
} from "../utils/tokenHelpers"

/**
 * Service for analyzing editor context and extracting meaningful information
 * Uses Continue's sophisticated token-aware context expansion approach
 */
export class EditorContextAnalyzer {
	/**
	 * Get dynamically expanded contextual text around cursor using token budget management.
	 * This replaces the old fixed 5/3 line approach with Continue's smart expansion.
	 */
	static getContextualText(context: EditorContextSnapshot, options?: Partial<ContextExpansionOptions>): string {
		const expansionOptions: ContextExpansionOptions = {
			maxPromptTokens: 2048,
			prefixPercentage: 0.85,
			maxSuffixPercentage: 0.15,
			modelName: "mercury-coder",
			...options,
		}

		const { prunedCaretWindow } = getPrunedPrefixSuffix(
			context.textBeforeCursor,
			context.textAfterCursor,
			expansionOptions,
		)

		return prunedCaretWindow
	}

	/**
	 * Get optimal editable region with token-aware expansion
	 */
	static getOptimalEditableRegion(
		context: EditorContextSnapshot,
		options?: Partial<ContextExpansionOptions>,
	): {
		startLine: number
		endLine: number
		prunedPrefix: string
		prunedSuffix: string
		totalTokens: number
	} {
		const expansionOptions: ContextExpansionOptions = {
			maxPromptTokens: 2048,
			prefixPercentage: 0.85,
			maxSuffixPercentage: 0.15,
			modelName: "mercury-coder",
			...options,
		}

		const cursorOffset = context.document.offsetAt(context.position)
		const result = calculateOptimalEditableRegion(context.fileContent, cursorOffset, expansionOptions)

		const totalTokens = countTokens(result.prunedPrefix + result.prunedSuffix, expansionOptions.modelName)

		return {
			startLine: result.startLine,
			endLine: result.endLine,
			prunedPrefix: result.prunedPrefix,
			prunedSuffix: result.prunedSuffix,
			totalTokens,
		}
	}

	/**
	 * Determine if cursor is at the beginning of a line
	 */
	static isAtLineStart(context: EditorContextSnapshot): boolean {
		return context.position.character === 0
	}

	/**
	 * Determine if cursor is at the end of a line
	 */
	static isAtLineEnd(context: EditorContextSnapshot): boolean {
		const currentLine = context.currentLineText
		return context.position.character === currentLine.length
	}

	/**
	 * Get the indentation level of the current line
	 */
	static getCurrentIndentation(context: EditorContextSnapshot): string {
		const currentLine = context.currentLineText
		const match = currentLine.match(/^(\s*)/)
		return match ? match[1] : ""
	}

	/**
	 * Check if cursor is inside a specific code construct (basic heuristics)
	 */
	static getCursorContext(context: EditorContextSnapshot): CursorContext {
		const textBefore = context.textBeforeCursor
		const textAfter = context.textAfterCursor
		const currentLine = context.currentLineText.trim()

		// Basic heuristics for code context
		const isInFunction = /function\s+\w+\s*\([^)]*\)\s*\{[^}]*$/.test(textBefore)
		const isInClass = /class\s+\w+\s*(?:extends\s+\w+)?\s*\{[^}]*$/.test(textBefore)
		const isInString = this.isInsideString(textBefore, textAfter)
		const isInComment = this.isInsideComment(textBefore, textAfter, context.languageId)

		return {
			isInFunction,
			isInClass,
			isInString,
			isInComment,
			isEmptyLine: currentLine === "",
			indentationLevel: this.getCurrentIndentation(context).length,
		}
	}

	/**
	 * Check if cursor is inside a string literal (basic detection)
	 */
	private static isInsideString(textBefore: string, textAfter: string): boolean {
		// Count unescaped quotes
		const singleQuotes = (textBefore.match(/(?<!\\)'/g) || []).length
		const doubleQuotes = (textBefore.match(/(?<!\\)"/g) || []).length
		const backticks = (textBefore.match(/(?<!\\)`/g) || []).length

		return singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || backticks % 2 === 1
	}

	/**
	 * Check if cursor is inside a comment (basic detection)
	 */
	private static isInsideComment(textBefore: string, textAfter: string, languageId: string): boolean {
		// Handle single-line comments
		const lines = textBefore.split("\n")
		const currentLine = lines[lines.length - 1] || ""

		if (languageId === "javascript" || languageId === "typescript") {
			return currentLine.includes("//")
		} else if (languageId === "python") {
			return currentLine.includes("#")
		}

		// Handle multi-line comments (basic)
		if (languageId === "javascript" || languageId === "typescript") {
			const openComments = (textBefore.match(/\/\*/g) || []).length
			const closeComments = (textBefore.match(/\*\//g) || []).length
			return openComments > closeComments
		}

		return false
	}

	/**
	 * Estimate token count for a given text using the context's model
	 */
	static estimateTokenCount(text: string, context: EditorContextSnapshot, modelName?: string): number {
		return countTokens(text, modelName || "mercury-coder")
	}

	/**
	 * Legacy compatibility method for textAroundCursor
	 * @deprecated Use getContextualText instead for token-aware expansion
	 */
	static getTextAroundCursor(context: EditorContextSnapshot): string {
		return this.getContextualText(context, {
			maxPromptTokens: 1024,
			prefixPercentage: 0.7,
			maxSuffixPercentage: 0.3,
		})
	}
}

/**
 * Context analysis results interface
 */
export interface CursorContext {
	readonly isInFunction: boolean
	readonly isInClass: boolean
	readonly isInString: boolean
	readonly isInComment: boolean
	readonly isEmptyLine: boolean
	readonly indentationLevel: number
}

/**
 * Default context expansion options for different scenarios
 */
export const CONTEXT_EXPANSION_PRESETS = {
	// Mercury Coder optimized
	MERCURY: {
		maxPromptTokens: 2048,
		prefixPercentage: 0.85,
		maxSuffixPercentage: 0.15,
		modelName: "mercury-coder",
	} as ContextExpansionOptions,

	// Balanced for general models
	BALANCED: {
		maxPromptTokens: 1024,
		prefixPercentage: 0.7,
		maxSuffixPercentage: 0.3,
		modelName: "gpt-4",
	} as ContextExpansionOptions,

	// Conservative for smaller models
	CONSERVATIVE: {
		maxPromptTokens: 512,
		prefixPercentage: 0.6,
		maxSuffixPercentage: 0.4,
		modelName: "claude-3-haiku",
	} as ContextExpansionOptions,
}
