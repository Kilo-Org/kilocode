import * as vscode from "vscode"

/**
 * Configuration options for text insertion processing
 */
export interface TextInsertionOptions {
	/** Whether to trim overlapping prefix text */
	trimPrefix?: boolean
	/** Whether to trim overlapping suffix text */
	trimSuffix?: boolean
}

/**
 * Result of text insertion processing
 */
export interface TextInsertionResult {
	/** The processed text ready for insertion */
	processedText: string
	/** The range where the text should be inserted */
	insertRange: vscode.Range
	/** Information about what modifications were made */
	modifications: {
		prefixTrimmed: number
		suffixTrimmed: number
		originalLength: number
	}
}

/**
 * Context information about the insertion point
 */
export interface InsertionContext {
	/** The document where text will be inserted */
	document: vscode.TextDocument
	/** The position where text will be inserted */
	position: vscode.Position
	/** The text to be inserted */
	textToInsert: string
}

/**
 * Finds the longest common prefix between two strings, trimming whitespace
 * @param str1 First string
 * @param str2 Second string
 * @returns The length of the prefix in str2 that should be removed
 */
function findMaxPrefixOverlap(textBefore: string, completionText: string): number {
	// Check for exact overlap
	for (let i = Math.min(textBefore.length, completionText.length); i > 0; i--) {
		if (textBefore.endsWith(completionText.substring(0, i))) {
			return i
		}
	}

	// Handle whitespace before keywords
	const trimmedTextBefore = textBefore.trim()
	if (trimmedTextBefore) {
		// See if the trimmed text is at the start of the completion
		if (completionText.trim().startsWith(trimmedTextBefore)) {
			// Find where this keyword actually ends in the completion text
			const startPos = completionText.indexOf(trimmedTextBefore)
			if (startPos >= 0) {
				let endPos = startPos + trimmedTextBefore.length
				// Include whitespace after the keyword
				while (endPos < completionText.length && completionText[endPos] === " ") {
					endPos++
				}
				return endPos
			}
		}
	}

	return 0
}

/**
 * Finds the longest common suffix between two strings
 * @param completionText The completion text
 * @param textAfter The text after the cursor
 * @returns The length of the suffix in completionText that should be removed
 */
function findMaxSuffixOverlap(completionText: string, textAfter: string): number {
	// Check for exact overlap
	for (let i = Math.min(textAfter.length, completionText.length); i > 0; i--) {
		if (completionText.endsWith(textAfter.substring(0, i))) {
			return i
		}
	}

	return 0
}

/**
 * Gets the text context around an insertion point
 */
function getInsertionContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): {
	textBefore: string
	textAfter: string
	contextRange: vscode.Range
} {
	// Get text before cursor - go from start of file to be thorough
	const startOfDoc = new vscode.Position(0, 0)
	const beforeRange = new vscode.Range(startOfDoc, position)
	const textBefore = document.getText(beforeRange)

	// Get text after cursor - go to end of file to be thorough
	const endOfDoc = new vscode.Position(document.lineCount - 1, Infinity)
	const afterRange = new vscode.Range(position, endOfDoc)
	const textAfter = document.getText(afterRange)

	const contextRange = new vscode.Range(startOfDoc, endOfDoc)

	return {
		textBefore,
		textAfter,
		contextRange,
	}
}

/**
 * Processes text for insertion, removing overlaps with existing content
 * @param context The insertion context
 * @param options Processing options
 * @returns Processed insertion result or null if nothing to insert
 */
export function processTextInsertion(
	context: InsertionContext,
	options: TextInsertionOptions = {},
): TextInsertionResult | null {
	const { trimPrefix = true, trimSuffix = true } = options
	const { document, position, textToInsert } = context

	if (!textToInsert || textToInsert.length === 0) {
		return null
	}

	const originalLength = textToInsert.length
	const { textBefore, textAfter } = getInsertionContext(document, position)

	let processedText = textToInsert
	let prefixTrimmed = 0
	let suffixTrimmed = 0

	// Handle prefix overlap
	if (trimPrefix && textBefore.length > 0) {
		prefixTrimmed = findMaxPrefixOverlap(textBefore, textToInsert)
		if (prefixTrimmed > 0) {
			processedText = textToInsert.substring(prefixTrimmed)
		}
	}

	// Handle suffix overlap
	if (trimSuffix && textAfter.length > 0) {
		suffixTrimmed = findMaxSuffixOverlap(processedText, textAfter)

		if (suffixTrimmed > 0) {
			processedText = processedText.substring(0, processedText.length - suffixTrimmed)
		}
	}

	if (processedText.length === 0) {
		return null
	}

	// Adjust the insertRange to account for any text that might already be on the line.
	// This is important to handle the autoClosing braces that VSCode adds as you type.
	const firstLine = textToInsert.match(/^.*$/m)?.[0] ?? processedText
	const removeCharCount = firstLine.includes(textAfter) ? textAfter.length : 0
	const insertRange = new vscode.Range(position, position.translate(0, removeCharCount))

	return {
		processedText,
		insertRange,
		modifications: {
			prefixTrimmed,
			suffixTrimmed,
			originalLength,
		},
	}
}
